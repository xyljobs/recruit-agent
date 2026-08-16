import { createHmac } from 'crypto';
import type { NextRequest } from 'next/server';
import { getJwtSecretKey } from '@/lib/security';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';

const RATE_WINDOW_MINUTES = 15;
const IDENTIFIER_ATTEMPT_LIMIT = 10;
const IP_ATTEMPT_LIMIT = 30;
export const ACCOUNT_LOCK_THRESHOLD = 5;
export const ACCOUNT_LOCK_MINUTES = 15;

function keyedHash(value: string): string {
  return createHmac('sha256', getJwtSecretKey()).update(value).digest('hex');
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || 'unknown'
  );
}

function attemptIdentity(request: NextRequest, email: string): {
  identifierHash: string;
  ipHash: string;
} {
  return {
    identifierHash: keyedHash(email.trim().toLowerCase()),
    ipHash: keyedHash(getClientIp(request)),
  };
}

export async function isLoginRateLimited(
  request: NextRequest,
  email: string,
): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { identifierHash, ipHash } = attemptIdentity(request, email);
  const cutoff = new Date(
    Date.now() - RATE_WINDOW_MINUTES * 60 * 1000,
  ).toISOString();
  const [identifierResult, ipResult] = await Promise.all([
    supabase
      .from('auth_login_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('identifier_hash', identifierHash)
      .eq('succeeded', false)
      .gte('created_at', cutoff),
    supabase
      .from('auth_login_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .eq('succeeded', false)
      .gte('created_at', cutoff),
  ]);
  if (identifierResult.error || ipResult.error) {
    throw new Error(
      identifierResult.error?.message
      || ipResult.error?.message
      || '登录限流检查失败',
    );
  }
  return (
    (identifierResult.count ?? 0) >= IDENTIFIER_ATTEMPT_LIMIT
    || (ipResult.count ?? 0) >= IP_ATTEMPT_LIMIT
  );
}

async function recordAttempt(
  request: NextRequest,
  email: string,
  succeeded: boolean,
): Promise<void> {
  const { identifierHash, ipHash } = attemptIdentity(request, email);
  const { error } = await getSupabaseServiceClient()
    .from('auth_login_attempts')
    .insert({
      identifier_hash: identifierHash,
      ip_hash: ipHash,
      succeeded,
    });
  if (error) {
    throw new Error(`记录登录尝试失败: ${error.message}`);
  }
}

export async function recordLoginFailure(
  request: NextRequest,
  email: string,
  userId?: string,
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  await recordAttempt(request, email, false);
  if (!userId) {
    return;
  }
  const { error } = await supabase.rpc('record_failed_login', {
    p_user_id: userId,
    p_lock_threshold: ACCOUNT_LOCK_THRESHOLD,
    p_lock_minutes: ACCOUNT_LOCK_MINUTES,
  });
  if (error) {
    throw new Error(`更新登录锁定状态失败: ${error.message}`);
  }
}

export async function recordLoginSuccess(
  request: NextRequest,
  email: string,
  userId: string,
  organizationId: string,
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { identifierHash } = attemptIdentity(request, email);
  await recordAttempt(request, email, true);
  const [userResult, attemptsResult] = await Promise.all([
    // 多组织模型：users.organization_id 仅表示主组织，按它过滤会在登录非主组织时 0 行更新；
    // 租户归属已在登录流程经 organization_members 校验，这里只按用户 id 更新自身行
    supabase
      .from('users')
      .update({
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: new Date().toISOString(),
      })
      .eq('id', userId),
    supabase
      .from('auth_login_attempts')
      .delete()
      .eq('identifier_hash', identifierHash)
      .eq('succeeded', false),
  ]);
  if (userResult.error || attemptsResult.error) {
    throw new Error(
      userResult.error?.message
      || attemptsResult.error?.message
      || '更新登录状态失败',
    );
  }
}

export function isAccountLocked(lockedUntil: unknown): boolean {
  return (
    typeof lockedUntil === 'string'
    && Number.isFinite(Date.parse(lockedUntil))
    && Date.parse(lockedUntil) > Date.now()
  );
}
