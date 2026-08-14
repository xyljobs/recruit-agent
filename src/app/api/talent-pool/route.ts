import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiErrorResponse } from '@/lib/api-response';
import { getTenantRequestContext } from '@/lib/auth-server';
import { decryptField } from '@/lib/encryption';
import { loadProcessableCandidateIds } from '@/lib/privacy/authorization-access';
import { parseStrictSearchParams } from '@/lib/recruiting/api-contracts';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const talentPoolQuerySchema = z.strictObject({
  jobId: z.string().trim().uuid('职位ID格式无效'),
});

const TALENT_POOL_MIN_SCORE = 70;
const ACTIVE_ENGAGEMENT_STATUSES = ['contacted', 'interviewing', 'offered'];

/** 脱敏姓名：张**三 */
function maskName(name: string | null): string {
  if (!name) return '未知';
  if (name.length <= 1) return name;
  if (name.length === 2) return name[0] + '*';
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
}

interface MatchRecordRow {
  candidate_id: string;
  status: string;
  overall_score: number | null;
  created_at: string;
}

interface TalentPoolCandidateRow {
  id: string;
  name: string | null;
  skills: string[] | null;
}

interface TalentPoolCandidate {
  candidate_id: string;
  name: string;
  best_score: number;
  matched_skills: string[];
  last_matched_at: string;
}

/**
 * 人才池再激活 - 返回历史高分（overall_score >= 70）、当前未被积极跟进
 * 且技能与职位要求有交集的已授权候选人（脱敏）
 */
export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.talentPoolRead);
    const { searchParams } = new URL(request.url);
    const query = await parseStrictSearchParams(searchParams, talentPoolQuerySchema);

    const { data: job, error: jobError } = await supabase
      .from('job_requirements')
      .select('id, title, skills_required')
      .eq('id', query.jobId)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (jobError) {
      throw new Error(`查询职位失败: ${jobError.message}`);
    }
    if (!job) {
      return NextResponse.json(
        { success: false, error: '职位不存在' },
        { status: 404 },
      );
    }
    const jobSkills = new Set(
      ((job.skills_required ?? []) as string[]).map(skill => skill.toLowerCase()),
    );
    if (jobSkills.size === 0) {
      return NextResponse.json({
        success: true,
        data: { job_title: job.title, candidates: [] as TalentPoolCandidate[] },
      });
    }

    // 合规前提：仅统计证据已核验且仍在处理期限内的候选人
    const processableCandidateIds = await loadProcessableCandidateIds(
      supabase,
      user.organizationId,
    );
    if (processableCandidateIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: { job_title: job.title, candidates: [] as TalentPoolCandidate[] },
      });
    }

    const { data: records, error: recordsError } = await supabase
      .from('match_records')
      .select('candidate_id, status, overall_score, created_at')
      .eq('organization_id', user.organizationId)
      .in('candidate_id', processableCandidateIds);
    if (recordsError) {
      throw new Error(`查询匹配记录失败: ${recordsError.message}`);
    }

    // 聚合每位候选人的历史最高分、最近匹配时间，并标记正在积极跟进的候选人
    const bestByCandidate = new Map<string, number>();
    const latestByCandidate = new Map<string, string>();
    const activelyEngaged = new Set<string>();
    for (const record of (records ?? []) as unknown as MatchRecordRow[]) {
      if (ACTIVE_ENGAGEMENT_STATUSES.includes(record.status)) {
        activelyEngaged.add(record.candidate_id);
      }
      const score = record.overall_score ?? 0;
      if (score > (bestByCandidate.get(record.candidate_id) ?? 0)) {
        bestByCandidate.set(record.candidate_id, score);
      }
      const createdAt = record.created_at;
      const latest = latestByCandidate.get(record.candidate_id);
      if (!latest || createdAt > latest) {
        latestByCandidate.set(record.candidate_id, createdAt);
      }
    }

    const qualifiedIds = Array.from(bestByCandidate.entries())
      .filter(([candidateId, score]) => (
        score >= TALENT_POOL_MIN_SCORE && !activelyEngaged.has(candidateId)
      ))
      .map(([candidateId]) => candidateId);
    if (qualifiedIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: { job_title: job.title, candidates: [] as TalentPoolCandidate[] },
      });
    }

    const { data: candidates, error: candidatesError } = await supabase
      .from('candidates')
      .select('id, name, skills')
      .eq('organization_id', user.organizationId)
      .in('id', qualifiedIds)
      .limit(50);
    if (candidatesError) {
      throw new Error(`查询候选人失败: ${candidatesError.message}`);
    }

    const pool: TalentPoolCandidate[] = [];
    for (const candidate of (candidates ?? []) as unknown as TalentPoolCandidateRow[]) {
      const matchedSkills = ((candidate.skills ?? []) as string[]).filter(skill => (
        jobSkills.has(skill.toLowerCase())
      ));
      if (matchedSkills.length === 0) continue;
      pool.push({
        candidate_id: candidate.id,
        name: maskName(decryptField(candidate.name)),
        best_score: bestByCandidate.get(candidate.id) ?? 0,
        matched_skills: matchedSkills,
        last_matched_at: latestByCandidate.get(candidate.id) ?? '',
      });
    }
    pool.sort((a, b) => b.best_score - a.best_score);

    return NextResponse.json({
      success: true,
      data: { job_title: job.title, candidates: pool },
    });
  } catch (error) {
    return apiErrorResponse(error, '获取人才池候选失败');
  }
}
