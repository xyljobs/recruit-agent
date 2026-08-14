import { jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { getJwtSecretKey, getSupabaseJwtSecretKey } from '@/lib/security';

export const AUTH_SESSION_VERSION = 2;
export const AUTH_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

// 会话校验 RPC 的超时上限：网络故障时必须快速失败（返回 401 跳登录页），
// 而不是让客户端请求无限挂起导致页面卡在加载中。
const AUTH_SESSION_VALIDATION_TIMEOUT_MS = 10_000;

interface AuthSessionUser {
  id: string;
  email: string;
  name: string;
  appRole: string;
  organizationId: string;
  mustChangePassword: boolean;
  authVersion: number;
  sessionId: string;
}

export interface CurrentAuthSession {
  userId: string;
  organizationId: string;
  role: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
  authVersion: number;
  sessionId: string;
}

export function isCurrentAuthSession(payload: JWTPayload): boolean {
  return (
    payload.sessionVersion === AUTH_SESSION_VERSION
    && typeof payload.jti === 'string'
    && typeof payload.authVersion === 'number'
  );
}

export async function createAuthToken(user: AuthSessionUser): Promise<string> {
  return new SignJWT({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: 'authenticated',
    appRole: user.appRole,
    organizationId: user.organizationId,
    mustChangePassword: user.mustChangePassword,
    authVersion: user.authVersion,
    sessionVersion: AUTH_SESSION_VERSION,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setJti(user.sessionId)
    .setExpirationTime(`${AUTH_SESSION_MAX_AGE_SECONDS}s`)
    .setIssuedAt()
    .sign(getJwtSecretKey());
}

function getSupabaseServiceCredentials(): { url: string; serviceRoleKey: string } {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('认证状态服务未配置');
  }
  return { url: url.replace(/\/$/, ''), serviceRoleKey };
}

export async function verifyCurrentAuthSession(token: string): Promise<CurrentAuthSession> {
  const { payload } = await jwtVerify(token, getJwtSecretKey());
  if (!isCurrentAuthSession(payload)) {
    throw new Error('登录信息已过期');
  }

  const userId = typeof payload.userId === 'string' ? payload.userId : '';
  const organizationId = typeof payload.organizationId === 'string'
    ? payload.organizationId
    : '';
  const authVersion = typeof payload.authVersion === 'number'
    ? payload.authVersion
    : -1;
  const sessionId = payload.jti ?? '';
  if (!userId || !organizationId || !sessionId || authVersion < 1) {
    throw new Error('登录信息无效');
  }

  const { url, serviceRoleKey } = getSupabaseServiceCredentials();
  const response = await fetch(`${url}/rest/v1/rpc/validate_auth_session`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_session_id: sessionId,
      p_user_id: userId,
      p_organization_id: organizationId,
      p_auth_version: authVersion,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(AUTH_SESSION_VALIDATION_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error('认证状态校验失败');
  }

  const state = await response.json() as {
    role?: unknown;
    email?: unknown;
    name?: unknown;
    mustChangePassword?: unknown;
    authVersion?: unknown;
  } | null;
  if (
    !state
    || typeof state.role !== 'string'
    || typeof state.email !== 'string'
    || typeof state.name !== 'string'
    || typeof state.authVersion !== 'number'
  ) {
    throw new Error('登录已失效');
  }

  return {
    userId,
    organizationId,
    role: state.role,
    email: state.email,
    name: state.name,
    mustChangePassword: state.mustChangePassword === true,
    authVersion: state.authVersion,
    sessionId,
  };
}

export async function createDatabaseAccessToken(
  user: Pick<AuthSessionUser, 'id' | 'appRole' | 'organizationId'>,
): Promise<string> {
  return new SignJWT({
    role: 'authenticated',
    userId: user.id,
    appRole: user.appRole,
    organizationId: user.organizationId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setExpirationTime('5m')
    .setIssuedAt()
    .sign(getSupabaseJwtSecretKey());
}
