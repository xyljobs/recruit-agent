import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenantRequestContext } from '@/lib/auth-server';
import { decryptField } from '@/lib/encryption';
import {
  batchMatchBodySchema,
  batchMatchStatusQuerySchema,
  MAX_BATCH_MATCH_CANDIDATES,
  parseLimitedJson,
  SMALL_JSON_BODY_LIMIT,
} from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import {
  normalizeRecruitingApiError,
  rpcErrorToRequestError,
} from '@/lib/recruiting/api-contracts';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const storedMatchSchema = z.object({
  candidate_id: z.string(),
  overall_score: z.number(),
  skill_score: z.number(),
  experience_score: z.number(),
  education_score: z.number(),
  salary_score: z.number(),
  location_score: z.number(),
  availability_score: z.number(),
  stability_score: z.number(),
  match_details: z.unknown(),
  record_id: z.string().nullable(),
  rank: z.number().int().positive().optional(),
  recommendation_band: z.enum(['strong', 'consider', 'insufficient_information']).optional(),
  confidence_score: z.number().int().min(0).max(100).optional(),
  confidence_breakdown: z.object({
    jd_completeness: z.number(),
    candidate_completeness: z.number(),
    evidence_coverage: z.number(),
    data_freshness: z.number(),
  }).optional(),
  evidence_snapshot: z.array(z.unknown()).optional(),
  missing_information: z.array(z.string()).optional(),
});

const storedResultSchema = z.object({
  matches: z.array(storedMatchSchema),
  total: z.number().int().min(0),
  job_id: z.string(),
  shortlist_run_id: z.string().nullable().optional(),
  excluded_due_to_decision_rights: z.number().int().min(0).optional(),
});

const shortlistBatchResultSchema = z.object({
  shortlist_run_id: z.string(),
  task_id: z.string(),
  status: z.string(),
  idempotent: z.boolean(),
});

/**
 * POST /api/match/batch
 * 将批量匹配任务入队，由独立 Worker 处理，避免请求内全量读取和并发写库。
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.batchMatchSubmit);
    const body = await parseLimitedJson(
      request,
      batchMatchBodySchema,
      SMALL_JSON_BODY_LIMIT,
    );

    const { data: job, error: jobError } = await supabase
      .from('job_requirements')
      .select('id')
      .eq('id', body.job_id)
      .eq('organization_id', user.organizationId)
      .single();
    if (jobError || !job) {
      return NextResponse.json(
        { success: false, error: '职位不存在' },
        { status: 404 },
      );
    }

    const { data: rpcResult, error: taskError } = await supabase.rpc(
      'create_shortlist_batch',
      {
        p_job_id: body.job_id,
        p_candidate_ids: body.candidate_ids ?? null,
        p_top_n: body.top_n,
        p_client_event_id: body.client_event_id,
      },
    );
    if (taskError) {
      throw rpcErrorToRequestError(taskError, '短名单任务入队失败');
    }
    const task = shortlistBatchResultSchema.safeParse(rpcResult);
    if (!task.success) {
      throw new Error('短名单任务入队失败: 数据库未返回有效任务');
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          taskId: task.data.task_id,
          shortlistRunId: task.data.shortlist_run_id,
          status: task.data.status,
          idempotent: task.data.idempotent,
          candidateLimit: body.candidate_ids?.length || MAX_BATCH_MATCH_CANDIDATES,
        },
      },
      { status: 202 },
    );
  } catch (error) {
    return apiErrorResponse(
      normalizeRecruitingApiError(error, '批量匹配任务提交失败'),
      '批量匹配任务提交失败',
    );
  }
}

/**
 * GET /api/match/batch?taskId=...
 * 查询后台任务状态；完成后按需解密并脱敏 Top N 候选人信息。
 */
export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.batchMatchStatus);
    const { searchParams } = new URL(request.url);
    const query = batchMatchStatusQuerySchema.safeParse({
      taskId: searchParams.get('taskId') ?? undefined,
    });
    if (!query.success) {
      return NextResponse.json(
        { success: false, error: query.error.issues[0]?.message || '任务ID无效' },
        { status: 400 },
      );
    }

    let taskQuery = supabase
      .from('match_batch_tasks')
      .select('id, job_id, status, candidate_count, result, error_message, created_at, started_at, finished_at')
      .eq('id', query.data.taskId)
      .eq('organization_id', user.organizationId);
    if (user.role !== 'admin') {
      taskQuery = taskQuery.eq('user_id', user.userId);
    }
    const { data: task, error: taskError } = await taskQuery.single();
    if (taskError || !task) {
      return NextResponse.json(
        { success: false, error: '批量匹配任务不存在' },
        { status: 404 },
      );
    }

    const result = storedResultSchema.safeParse(task.result);
    const hydratedResult = result.success
      ? await hydrateMatches(supabase, user.organizationId, result.data)
      : null;

    return NextResponse.json({
      success: true,
      data: {
        taskId: task.id,
        jobId: task.job_id,
        status: task.status,
        candidateCount: task.candidate_count || 0,
        result: hydratedResult,
        errorMessage: task.error_message,
        createdAt: task.created_at,
        startedAt: task.started_at,
        finishedAt: task.finished_at,
      },
    });
  } catch (error) {
    console.error('批量匹配任务查询失败:', error);
    return apiErrorResponse(error, '批量匹配任务查询失败');
  }
}

async function hydrateMatches(
  supabase: Awaited<ReturnType<typeof getTenantRequestContext>>['supabase'],
  organizationId: string,
  result: z.infer<typeof storedResultSchema>,
) {
  const candidateIds = result.matches.map(match => match.candidate_id);
  if (candidateIds.length === 0) {
    return result;
  }

  const { data: candidates, error } = await supabase
    .from('candidates')
    .select('id, name, current_company, current_position')
    .eq('organization_id', organizationId)
    .in('id', candidateIds);
  if (error) {
    throw new Error(`读取匹配候选人失败: ${error.message}`);
  }

  const candidateMap = new Map((candidates || []).map(candidate => [
    candidate.id,
    {
      name: maskName(decryptField(candidate.name)),
      currentCompany: decryptField(candidate.current_company),
      currentPosition: decryptField(candidate.current_position),
    },
  ]));

  return {
    ...result,
    matches: result.matches.map(match => {
      const candidate = candidateMap.get(match.candidate_id);
      return {
        ...match,
        candidate_name: candidate?.name || '***',
        current_company: candidate?.currentCompany || null,
        current_position: candidate?.currentPosition || null,
      };
    }),
  };
}

function maskName(name: string | null): string {
  if (!name || name === '***') return '***';
  if (name.length <= 1) return '*';
  return name[0] + '*'.repeat(name.length - 1);
}
