import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { buildMatchScoringInput } from '@/lib/ai/match-scoring';
import { decryptField } from '@/lib/encryption';
import {
  BASE_SCORING_MODEL,
  calculateBaseMatchScore,
} from '@/lib/matching/scorer';
import { buildBatchShortlistEntries } from '@/lib/matching/batch-shortlist';
import { CONFIDENCE_FORMULA_VERSION } from '@/lib/matching/confidence';
import { saveMatchScoring } from '@/lib/matching/match-record-store';
import { loadActiveScoringWeights } from '@/lib/matching/scoring-weights';
import { loadAutomatedDecisionEligibleCandidateIds } from '@/lib/privacy/authorization-access';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';

for (const name of [
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ENCRYPTION_KEY',
]) {
  const secretPath = process.env[`${name}_FILE`]?.trim();
  if (!secretPath) {
    continue;
  }
  if (process.env[name]?.trim()) {
    throw new Error(`${name} and ${name}_FILE cannot both be set`);
  }
  if (!existsSync(secretPath)) {
    throw new Error(`${name}_FILE does not exist`);
  }
  const value = readFileSync(secretPath, 'utf8').trim();
  if (!value) {
    throw new Error(`${name}_FILE points to an empty secret`);
  }
  process.env[name] = value;
}

const WORKER_ID = process.env.MATCH_BATCH_WORKER_ID
  || `match-worker-${hostname()}-${randomUUID().slice(0, 8)}`;
const LEASE_SECONDS = 30 * 60;
const DEFAULT_INTERVAL_MS = 2_000;

const taskSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  job_id: z.string(),
  candidate_ids: z.array(z.string()).nullable(),
  candidate_limit: z.number().int().min(1).max(100),
  top_n: z.number().int().min(1).max(50),
});

const persistedShortlistEntrySchema = z.object({
  candidate_id: z.string(),
  rank: z.number().int().positive(),
  recommendation_band: z.enum(['strong', 'consider', 'insufficient_information']),
  confidence_score: z.number().int().min(0).max(100),
  confidence_breakdown: z.object({
    jd_completeness: z.number(),
    candidate_completeness: z.number(),
    evidence_coverage: z.number(),
    data_freshness: z.number(),
  }),
  evidence_snapshot: z.array(z.unknown()),
  missing_information: z.array(z.string()),
});

type MatchBatchTask = z.infer<typeof taskSchema>;

async function claimTask(supabase: SupabaseClient): Promise<MatchBatchTask | null> {
  const { data, error } = await supabase.rpc('claim_match_batch_task', {
    p_worker_id: WORKER_ID,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) {
    throw new Error(`认领批量匹配任务失败: ${error.message}`);
  }

  const candidate = Array.isArray(data) ? data[0] : data;
  if (!candidate) {
    return null;
  }
  const parsed = taskSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`批量匹配任务结构无效: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function processTask(
  supabase: SupabaseClient,
  task: MatchBatchTask,
): Promise<void> {
  let shortlistRunId: string | null = null;
  try {
    const { data: shortlistRun, error: shortlistRunError } = await supabase
      .from('shortlist_runs')
      .select('id, status')
      .eq('organization_id', task.organization_id)
      .eq('source_match_batch_task_id', task.id)
      .maybeSingle();
    if (shortlistRunError) {
      throw new Error(`读取短名单运行失败: ${shortlistRunError.message}`);
    }
    shortlistRunId = shortlistRun?.id ?? null;

    const { data: job, error: jobError } = await supabase
      .from('job_requirements')
      .select('*')
      .eq('id', task.job_id)
      .eq('organization_id', task.organization_id)
      .single();
    if (jobError || !job) {
      throw new Error('职位不存在或已删除');
    }
    const activeScoringWeights = await loadActiveScoringWeights(supabase, task.organization_id);
    if (shortlistRunId) {
      const { error: startRunError } = await supabase.rpc(
        'update_match_batch_task_from_worker',
        {
          p_organization_id: task.organization_id,
          p_task_id: task.id,
          p_worker_id: WORKER_ID,
          p_action: 'start',
          p_confidence_formula_version: CONFIDENCE_FORMULA_VERSION,
          p_scoring_weights_version: activeScoringWeights.version,
        },
      );
      if (startRunError) throw new Error(`启动短名单运行失败: ${startRunError.message}`);
    }

    const requestedCandidateIds = task.candidate_ids
      ?? await loadCandidateIds(
        supabase,
        task.organization_id,
        task.candidate_limit,
      );
    const eligibleCandidateIds =
      await loadAutomatedDecisionEligibleCandidateIds(
        supabase,
        task.organization_id,
        requestedCandidateIds,
      );
    const noEligibleCandidateSentinel =
      '00000000-0000-0000-0000-000000000000';
    const candidateIdsForQuery = eligibleCandidateIds.length > 0
      ? eligibleCandidateIds
      : [noEligibleCandidateSentinel];

    const candidateQuery = supabase
      .from('candidates')
      .select('*')
      .eq('organization_id', task.organization_id)
      .eq('is_authorized', true)
      .in('id', candidateIdsForQuery)
      .order('created_at', { ascending: false })
      .limit(task.candidate_limit);

    const { data: candidates, error: candidateError } = await candidateQuery;
    if (candidateError) {
      throw new Error(`查询候选人失败: ${candidateError.message}`);
    }

    const scoredMatches = (candidates || []).map(candidate => {
      const scoringCandidate = {
        ...candidate,
        name: decryptField(candidate.name) || candidate.name,
        current_city: decryptField(candidate.current_city) || candidate.current_city,
        current_company: decryptField(candidate.current_company) || candidate.current_company,
        current_position: decryptField(candidate.current_position) || candidate.current_position,
      };
      const scoringInput = buildMatchScoringInput(
        job as Record<string, unknown>,
        scoringCandidate as Record<string, unknown>,
        {
          skillsKnowledge: '规则评分未使用外部技能知识',
          industryKnowledge: '规则评分未使用外部产业知识',
        },
      );
      const scores = calculateBaseMatchScore(
        scoringInput.job,
        scoringInput.candidate,
        activeScoringWeights.weights,
      );

      return {
        candidateId: candidate.id,
        scores,
        scoringInput,
        candidate: scoringCandidate as Record<string, unknown>,
      };
    });

    const recordIdByCandidate = new Map<string, string>();
    if (scoredMatches.length > 0) {
      for (const match of scoredMatches) {
        const record = await saveMatchScoring(
          supabase,
          {
            organizationId: task.organization_id,
            jobId: task.job_id,
            candidateId: match.candidateId,
          },
          {
            overall_score: match.scores.overall_score,
            skill_score: match.scores.skill_score,
            experience_score: match.scores.experience_score,
            education_score: match.scores.education_score,
            salary_score: match.scores.salary_score,
            location_score: match.scores.location_score,
            availability_score: match.scores.availability_score,
            stability_score: match.scores.stability_score,
            match_details: match.scores.match_details,
            scoring_status: 'succeeded',
            scoring_error: null,
            scoring_model: BASE_SCORING_MODEL,
            scoring_prompt_version: null,
            scoring_input_snapshot: match.scoringInput,
            weights_version: activeScoringWeights.version,
            llm_status: 'not_requested',
            llm_error: null,
            llm_model: null,
            llm_prompt_version: null,
          },
        );
        recordIdByCandidate.set(record.candidate_id, record.id);
      }
    }

    const scoredResultByCandidate = new Map(scoredMatches.map(match => [
      match.candidateId,
      {
        candidate_id: match.candidateId,
        overall_score: match.scores.overall_score,
        skill_score: match.scores.skill_score,
        experience_score: match.scores.experience_score,
        education_score: match.scores.education_score,
        salary_score: match.scores.salary_score,
        location_score: match.scores.location_score,
        availability_score: match.scores.availability_score,
        stability_score: match.scores.stability_score,
        match_details: match.scores.match_details,
        record_id: recordIdByCandidate.get(match.candidateId) || null,
      },
    ]));

    let matches;
    if (shortlistRunId) {
      const rankedEntries = buildBatchShortlistEntries({
        job: job as Record<string, unknown>,
        candidates: scoredMatches.map(match => match.candidate),
        scores: scoredMatches.map(match => ({
          candidate_id: match.candidateId,
          match_record_id: recordIdByCandidate.get(match.candidateId) || null,
          overall_score: match.scores.overall_score,
          skill_score: match.scores.skill_score,
          experience_score: match.scores.experience_score,
          education_score: match.scores.education_score,
          salary_score: match.scores.salary_score,
          location_score: match.scores.location_score,
          availability_score: match.scores.availability_score,
          stability_score: match.scores.stability_score,
          match_details: match.scores.match_details,
        })),
        top_n: task.top_n,
      });
      const { error: finalizeError } = await supabase.rpc('finalize_shortlist_run', {
        p_organization_id: task.organization_id,
        p_shortlist_run_id: shortlistRunId,
        p_entries: rankedEntries,
        p_candidate_count: scoredMatches.length,
      });
      if (finalizeError) {
        throw new Error(`完成短名单运行失败: ${finalizeError.message}`);
      }

      // The RPC performs a final authorization check. Only candidates that
      // survived that check may appear in the task result returned to clients.
      const { data: persistedEntries, error: persistedEntriesError } = await supabase
        .from('shortlist_entries')
        .select([
          'candidate_id',
          'rank',
          'recommendation_band',
          'confidence_score',
          'confidence_breakdown',
          'evidence_snapshot',
          'missing_information',
        ].join(','))
        .eq('organization_id', task.organization_id)
        .eq('shortlist_run_id', shortlistRunId)
        .order('rank', { ascending: true });
      if (persistedEntriesError) {
        throw new Error(`读取已完成短名单失败: ${persistedEntriesError.message}`);
      }
      const verifiedEntries = z.array(persistedShortlistEntrySchema).parse(
        persistedEntries ?? [],
      );
      matches = verifiedEntries.map(entry => {
        const score = scoredResultByCandidate.get(entry.candidate_id);
        if (!score) {
          throw new Error(`短名单候选人 ${entry.candidate_id} 缺少匹配结果`);
        }
        return {
          ...score,
          rank: entry.rank,
          recommendation_band: entry.recommendation_band,
          confidence_score: entry.confidence_score,
          confidence_breakdown: entry.confidence_breakdown,
          evidence_snapshot: entry.evidence_snapshot,
          missing_information: entry.missing_information,
        };
      });
    } else {
      matches = [...scoredResultByCandidate.values()]
        .sort((left, right) => (
          right.overall_score - left.overall_score
          || left.candidate_id.localeCompare(right.candidate_id)
        ))
        .slice(0, task.top_n);
    }

    const { error: completeError } = await supabase.rpc(
      'update_match_batch_task_from_worker',
      {
        p_organization_id: task.organization_id,
        p_task_id: task.id,
        p_worker_id: WORKER_ID,
        p_action: 'complete',
        p_candidate_count: scoredMatches.length,
        p_result: {
          matches,
          total: scoredMatches.length,
          job_id: task.job_id,
          shortlist_run_id: shortlistRunId,
          excluded_due_to_decision_rights: Math.max(
            requestedCandidateIds.length - eligibleCandidateIds.length,
            0,
          ),
        },
      },
    );
    if (completeError) throw new Error(`更新任务完成状态失败: ${completeError.message}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    await supabase.rpc('update_match_batch_task_from_worker', {
      p_organization_id: task.organization_id,
      p_task_id: task.id,
      p_worker_id: WORKER_ID,
      p_action: 'fail',
      p_error_message: message.slice(0, 2_000),
    });
    throw error;
  }
}

async function loadCandidateIds(
  supabase: SupabaseClient,
  organizationId: string,
  limit: number,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('candidates')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('is_authorized', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`查询候选人范围失败: ${error.message}`);
  }
  return (data || []).map(candidate => candidate.id);
}

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  const intervalArgument = process.argv.find(argument => argument.startsWith('--interval='));
  const parsedInterval = intervalArgument
    ? Number(intervalArgument.slice('--interval='.length))
    : DEFAULT_INTERVAL_MS;
  const intervalMs = Number.isFinite(parsedInterval) && parsedInterval >= 250
    ? parsedInterval
    : DEFAULT_INTERVAL_MS;
  const supabase = getSupabaseServiceClient();

  console.log(`[match-batch-worker] 已启动 ${WORKER_ID}`);
  while (true) {
    try {
      const task = await claimTask(supabase);
      if (task) {
        await processTask(supabase, task);
        console.log(`[match-batch-worker] 任务完成 ${task.id}`);
      } else if (once) {
        console.log('[match-batch-worker] 没有待处理任务');
        return;
      }
    } catch (error) {
      console.error(
        '[match-batch-worker] 处理失败:',
        error instanceof Error ? error.message : String(error),
      );
      if (once) {
        throw error;
      }
    }

    if (once) {
      return;
    }
    await delay(intervalMs);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
