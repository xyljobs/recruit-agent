import { NextRequest, NextResponse } from 'next/server';
import { AiExecutionPolicyError } from '@/lib/ai/execution-policy';
import { createTenantAiExecutionGateway } from '@/lib/ai/gateway';
import { ApiRequestError, parseLimitedJson, SMALL_JSON_BODY_LIMIT } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { getTenantRequestContext } from '@/lib/auth-server';
import { decryptField } from '@/lib/encryption';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getProcessableAuthorizationContext } from '@/lib/privacy/authorization-access';
import {
  communicationBriefBodySchema,
  normalizeRecruitingApiError,
  rpcErrorToRequestError,
} from '@/lib/recruiting/api-contracts';
import {
  type CommunicationBriefContent,
  canPrepareCommunicationBrief,
  createRulesOnlyCommunicationBrief,
  parseModelCommunicationBrief,
} from '@/lib/recruiting/communication-brief';

const PROMPT_VERSION = 'communication-brief-v1';

const MODEL_PROMPT = `你是一位企业招聘人员的沟通准备助手。请基于已由招聘人员接受的短名单条目生成可审阅的沟通 brief。

约束：
1. 匹配信息仅用于准备沟通，不能承诺录用、Offer、薪酬或面试结果。
2. 不得把缺失、冲突或部分支持的信息陈述为事实。
3. 不得输出候选人评分、排序结论或自动拒绝建议。
4. 只返回一个严格 JSON 对象，不要 Markdown，不要额外字段。

JSON 字段：
- candidate_value_points: string[]，最多6项，仅包含有证据支持的沟通切入点
- facts_to_verify: string[]，最多8项
- interview_questions: string[]，最多8项
- prohibited_claims: string[]，最多8项
- draft_message: string，供招聘人员审核修改后使用

输入：
{input}`;

interface ShortlistEntryRow {
  id: string;
  shortlist_run_id: string;
  match_record_id: string | null;
  candidate_id: string;
  human_decision: string;
  evidence_snapshot: unknown;
  missing_information: unknown;
}

interface DecisionEventRow {
  decision: string;
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, { scope: 'communication-briefs:create' });
    const body = await parseLimitedJson(
      request,
      communicationBriefBodySchema,
      SMALL_JSON_BODY_LIMIT,
    );
    const entry = await resolveAcceptedEntry(
      supabase,
      user.organizationId,
      body.shortlist_entry_id,
      body.matchId,
    );
    const authorizationContext = await getProcessableAuthorizationContext(
      supabase,
      user.organizationId,
      entry.candidate_id,
    );
    if (!authorizationContext.processable) {
      throw new ApiRequestError('候选人授权已失效，不能读取资料或准备沟通', 403);
    }

    const { data: run, error: runError } = await supabase
      .from('shortlist_runs')
      .select('id, job_id')
      .eq('id', entry.shortlist_run_id)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (runError) throw new Error('shortlist run read failed');
    if (!run) throw new ApiRequestError('短名单不存在', 404);

    const [jobResult, candidateResult] = await Promise.all([
      supabase
        .from('job_requirements')
        .select('id, title, salary_range, location, skills_required, benefits')
        .eq('id', run.job_id)
        .eq('organization_id', user.organizationId)
        .maybeSingle(),
      supabase
        .from('candidates')
        .select('id, name, current_company, current_position, skills, experience_years')
        .eq('id', entry.candidate_id)
        .eq('organization_id', user.organizationId)
        .maybeSingle(),
    ]);
    if (jobResult.error || candidateResult.error) {
      throw new Error('communication brief source read failed');
    }
    if (!jobResult.data || !candidateResult.data) {
      throw new ApiRequestError('职位或候选人不存在', 404);
    }

    const job = jobResult.data;
    const candidate = candidateResult.data;
    const candidateName = decryptField(candidate.name) ?? '候选人';
    const currentCompany = decryptField(candidate.current_company);
    const currentPosition = decryptField(candidate.current_position);
    const communicationGoal = body.communication_goal
      ?? body.communicationGoal
      ?? '想邀请您进一步了解这个职位机会。';
    const evidence = Array.isArray(entry.evidence_snapshot)
      ? entry.evidence_snapshot
      : [];
    const modelEvidence = evidence.flatMap(item => {
      if (typeof item !== 'object' || item === null) return [];
      const finding = Reflect.get(item, 'finding');
      const supportLevel = Reflect.get(item, 'support_level');
      const dimension = Reflect.get(item, 'dimension');
      if (typeof finding !== 'string' || typeof supportLevel !== 'string') return [];
      return [{
        finding: finding.slice(0, 300),
        support_level: supportLevel,
        dimension: typeof dimension === 'string' ? dimension.slice(0, 100) : null,
      }];
    });
    const missingInformation = Array.isArray(entry.missing_information)
      ? entry.missing_information.filter((item): item is string => typeof item === 'string')
      : [];
    const briefInput = {
      candidate_name: candidateName,
      current_position: currentPosition,
      job_title: job.title || '相关职位',
      salary_range: job.salary_range,
      location: job.location,
      communication_goal: communicationGoal,
      evidence,
      missing_information: missingInformation,
    };

    const aiGateway = await createTenantAiExecutionGateway(
      supabase,
      user.organizationId,
      request.headers,
      authorizationContext.externalProcessors,
    );
    let content: CommunicationBriefContent;
    if (aiGateway.mode === 'rules_only') {
      content = createRulesOnlyCommunicationBrief(briefInput);
    } else {
      const prompt = MODEL_PROMPT.replace('{input}', JSON.stringify({
        job: {
          title: job.title,
          salary_range: job.salary_range,
          location: job.location,
          skills_required: job.skills_required,
          benefits: job.benefits,
        },
        candidate: {
          name: candidateName,
          current_company: currentCompany,
          current_position: currentPosition,
          skills: candidate.skills,
          experience_years: candidate.experience_years,
        },
        accepted_shortlist_evidence: modelEvidence,
        missing_information: missingInformation,
        communication_goal: communicationGoal,
      }));
      let rawOutput = '';
      const stream = aiGateway.stream(
        [{ role: 'user', content: prompt }],
        {
          model: aiGateway.policy.modelName ?? undefined,
          temperature: 0.4,
        },
        {
          directIdentifiers: [
            candidateName,
            currentCompany,
            currentPosition,
          ].filter((value): value is string => Boolean(value)),
        },
      );
      for await (const chunk of stream) {
        rawOutput += chunk.content;
        if (rawOutput.length > 20_000) {
          throw new ApiRequestError('模型返回内容过长', 502);
        }
      }
      try {
        content = parseModelCommunicationBrief(rawOutput);
      } catch {
        throw new ApiRequestError('模型未返回有效的结构化沟通 brief', 502);
      }
    }

    const { data: storedBrief, error: briefError } = await supabase.rpc(
      'create_communication_brief',
      {
        p_shortlist_entry_id: entry.id,
        p_prompt_version: PROMPT_VERSION,
        p_ai_mode: aiGateway.mode,
        p_candidate_value_points: content.candidate_value_points,
        p_facts_to_verify: content.facts_to_verify,
        p_interview_questions: content.interview_questions,
        p_prohibited_claims: content.prohibited_claims,
        p_draft_message: content.draft_message,
      },
    );
    if (briefError) {
      throw rpcErrorToRequestError(briefError, '保存沟通 brief 失败');
    }

    return NextResponse.json({
      success: true,
      data: {
        brief: storedBrief,
        script: content.draft_message,
        candidate_name: candidateName,
        job_title: job.title,
      },
    });
  } catch (error) {
    if (error instanceof AiExecutionPolicyError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: 503 },
      );
    }
    return apiErrorResponse(
      normalizeRecruitingApiError(error, '生成沟通 brief 失败'),
      '生成沟通 brief 失败',
    );
  }
}

async function resolveAcceptedEntry(
  supabase: Awaited<ReturnType<typeof getTenantRequestContext>>['supabase'],
  organizationId: string,
  shortlistEntryId: string | undefined,
  legacyMatchId: string | undefined,
): Promise<ShortlistEntryRow> {
  let query = supabase
    .from('shortlist_entries')
    .select('id, shortlist_run_id, match_record_id, candidate_id, human_decision, evidence_snapshot, missing_information')
    .eq('organization_id', organizationId);
  if (shortlistEntryId) {
    query = query.eq('id', shortlistEntryId);
  } else {
    query = query
      .eq('match_record_id', legacyMatchId as string)
      .order('created_at', { ascending: false });
  }
  const { data: entries, error } = await query.limit(1);
  if (error) throw new Error('shortlist entry read failed');
  const entry = entries?.[0] as ShortlistEntryRow | undefined;
  if (!entry) {
    throw new ApiRequestError('没有可用于沟通准备的短名单条目', 404);
  }

  const { data: decisionEvents, error: decisionError } = await supabase
    .from('recommendation_decision_events')
    .select('decision')
    .eq('organization_id', organizationId)
    .eq('shortlist_entry_id', entry.id)
    .order('occurred_at', { ascending: false })
    .order('recorded_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (decisionError) throw new Error('shortlist decision read failed');
  const latestDecision = decisionEvents?.[0] as DecisionEventRow | undefined;
  if (!canPrepareCommunicationBrief(entry.human_decision, latestDecision?.decision)) {
    throw new ApiRequestError('请先由招聘人员接受该短名单条目', 409);
  }
  return entry;
}
