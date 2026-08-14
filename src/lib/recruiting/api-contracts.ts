import { z } from 'zod';
import { ApiRequestError } from '@/lib/api-limits';

const uuidSchema = z.string().trim().uuid('ID 格式无效');
const boundedNoteSchema = z.string().trim().min(1).max(2000);

export const shortlistCreateBodySchema = z.strictObject({
  job_id: uuidSchema,
  candidate_ids: z.array(uuidSchema)
    .min(1, '候选人ID列表不能为空')
    .max(100, '单次最多处理 100 位候选人')
    .refine(ids => new Set(ids).size === ids.length, '候选人ID不能重复')
    .optional(),
  top_n: z.number().int().min(1).max(50).default(10),
  client_event_id: uuidSchema,
});

export const shortlistListQuerySchema = z.strictObject({
  runId: uuidSchema.optional(),
  jobId: uuidSchema.optional(),
  status: z.enum(['pending', 'running', 'ready', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const shortlistQualificationBodySchema = z.strictObject({
  client_event_id: uuidSchema,
});

export const routeIdParamsSchema = z.strictObject({
  runId: uuidSchema,
});

export const shortlistEntryParamsSchema = z.strictObject({
  runId: uuidSchema,
  entryId: uuidSchema,
});

export const recruitingOutcomeBodySchema = z.strictObject({
  match_record_id: uuidSchema,
  event_type: z.enum([
    'outreach_sent',
    'candidate_replied',
    'interview_scheduled',
    'interview_completed',
    'qualified_interview',
    'offer',
    'hired',
    'rejected',
    'withdrawn',
    'complaint',
    'stage_corrected',
  ]),
  client_event_id: uuidSchema,
  occurred_at: z.string().datetime({ offset: true }),
  reason_code: z.string().trim().min(1).max(100).optional(),
  note: boundedNoteSchema.optional(),
  target_stage: z.enum([
    'pending',
    'contacted',
    'interviewing',
    'offered',
    'hired',
    'rejected',
    'withdrawn',
  ]).optional(),
  supersedes_event_id: uuidSchema.optional(),
  writeback_connection_id: uuidSchema.optional(),
  writeback_client_event_id: uuidSchema.optional(),
}).superRefine((body, context) => {
  if (Boolean(body.writeback_connection_id) !== Boolean(body.writeback_client_event_id)) {
    context.addIssue({
      code: 'custom',
      path: ['writeback_connection_id'],
      message: 'ATS 回写必须同时提供连接 ID 和独立幂等 ID',
    });
  }
  if (
    ['rejected', 'withdrawn', 'complaint'].includes(body.event_type)
    && !body.reason_code
  ) {
    context.addIssue({
      code: 'custom',
      path: ['reason_code'],
      message: '该招聘结果必须填写原因',
    });
  }

  if (body.event_type === 'stage_corrected') {
    if (!body.reason_code) {
      context.addIssue({
        code: 'custom',
        path: ['reason_code'],
        message: '阶段更正必须填写原因',
      });
    }
    if (!body.target_stage) {
      context.addIssue({
        code: 'custom',
        path: ['target_stage'],
        message: '阶段更正必须指定目标阶段',
      });
    }
    if (!body.supersedes_event_id) {
      context.addIssue({
        code: 'custom',
        path: ['supersedes_event_id'],
        message: '阶段更正必须指定被更正事件',
      });
    }
  } else if (body.target_stage || body.supersedes_event_id) {
    context.addIssue({
      code: 'custom',
      path: ['target_stage'],
      message: '普通招聘结果不能携带阶段更正字段',
    });
  }
});

export const communicationBriefBodySchema = z.strictObject({
  shortlist_entry_id: uuidSchema.optional(),
  matchId: uuidSchema.optional(),
  communication_goal: z.string().trim().min(1).max(500).optional(),
  communicationGoal: z.string().trim().min(1).max(500).optional(),
}).superRefine((body, context) => {
  if (Number(Boolean(body.shortlist_entry_id)) + Number(Boolean(body.matchId)) !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['shortlist_entry_id'],
      message: '请且仅提供 shortlist_entry_id 或兼容字段 matchId',
    });
  }
  if (body.communication_goal && body.communicationGoal) {
    context.addIssue({
      code: 'custom',
      path: ['communication_goal'],
      message: '沟通目标不能重复提供',
    });
  }
});

export interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
}

export function normalizeRecruitingApiError(
  error: unknown,
  fallbackMessage: string,
): ApiRequestError {
  if (error instanceof ApiRequestError) return error;
  if (
    error instanceof Error
    && ['未登录', '登录信息已过期', '登录信息无效', '登录已失效'].includes(error.message)
  ) {
    return new ApiRequestError('登录状态无效，请重新登录', 401);
  }
  if (error instanceof Error && error.message === '权限不足') {
    return new ApiRequestError('权限不足', 403);
  }
  return new ApiRequestError(fallbackMessage, 500);
}

export function rpcErrorToRequestError(
  error: RpcErrorLike,
  fallbackMessage: string,
): ApiRequestError {
  const message = error.message ?? '';
  switch (error.code) {
    case '23505':
      return new ApiRequestError('幂等键已用于不同请求', 409);
    case 'P0002':
      if (message.includes('job is not active')) {
        return new ApiRequestError('职位未启用或已关闭，请刷新页面确认职位状态后重试', 404);
      }
      if (message.includes('job not found')) {
        return new ApiRequestError('职位不存在或已被删除，请刷新页面后重试', 404);
      }
      return new ApiRequestError('请求的记录不存在', 404);
    case '22023':
      return new ApiRequestError('请求不符合业务规则', 400);
    case '55000':
      return new ApiRequestError('当前状态不允许该操作', 409);
    case '28000':
    case '42501':
      return new ApiRequestError('权限不足', 403);
    default:
      return new ApiRequestError(fallbackMessage, 500);
  }
}

export function parseStrictSearchParams<TSchema extends z.ZodType>(
  searchParams: URLSearchParams,
  schema: TSchema,
): z.output<TSchema> {
  const values: Record<string, string> = {};
  for (const key of new Set(searchParams.keys())) {
    const allValues = searchParams.getAll(key);
    if (allValues.length !== 1) {
      throw new ApiRequestError(`查询参数 ${key} 不能重复`, 400);
    }
    values[key] = allValues[0];
  }

  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    throw new ApiRequestError(
      parsed.error.issues[0]?.message ?? '查询参数无效',
      400,
    );
  }
  return parsed.data;
}
