import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ApiRequestError } from '@/lib/api-limits';

export interface RateLimitPolicy {
  scope: string;
}

export const RATE_LIMITS = {
  candidateList: { scope: 'candidates:list' },
  jdParse: { scope: 'jd:parse' },
  interviewGuide: { scope: 'interview:guide' },
  interviewBankRead: { scope: 'interview:bank:read' },
  interviewBankWrite: { scope: 'interview:bank:write' },
  bossKeywords: { scope: 'boss:keywords' },
  bossExecute: { scope: 'boss:execute' },
  batchMatchSubmit: { scope: 'match:batch:submit' },
  batchMatchStatus: { scope: 'match:batch:status' },
  dashboard: { scope: 'dashboard:read' },
} satisfies Record<string, RateLimitPolicy>;

const rateLimitResultSchema = z.object({
  allowed: z.boolean(),
  remaining: z.coerce.number().int().min(0),
  retry_after_seconds: z.coerce.number().int().min(0),
});

export async function enforceRateLimit(
  supabase: SupabaseClient,
  policy: RateLimitPolicy,
): Promise<void> {
  const { data, error } = await supabase.rpc('consume_api_rate_limit', {
    p_scope: policy.scope,
  });

  if (error) {
    throw new Error(`速率限制检查失败: ${error.message}`);
  }

  const candidate = Array.isArray(data) ? data[0] : data;
  const parsed = rateLimitResultSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error('速率限制检查返回了无效结果');
  }

  if (!parsed.data.allowed) {
    const retryAfter = Math.max(parsed.data.retry_after_seconds, 1);
    throw new ApiRequestError(
      '请求过于频繁，请稍后重试',
      429,
      { 'Retry-After': String(retryAfter) },
    );
  }
}
