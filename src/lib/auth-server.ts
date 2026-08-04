import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import {
  getSupabaseClient,
  getSupabaseServiceClient,
} from '@/storage/database/supabase-client';
import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  createAuthToken,
  createDatabaseAccessToken,
  verifyCurrentAuthSession,
} from '@/lib/auth-session';

export interface RequestUser {
  userId: string;
  organizationId: string;
  role: string;
  email: string | null;
  name: string | null;
  mustChangePassword: boolean;
  authVersion: number;
  sessionId: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  appRole: string;
  organizationId: string;
  mustChangePassword: boolean;
  authVersion: number;
}

export interface TenantRequestContext {
  token: string;
  user: RequestUser;
  supabase: ReturnType<typeof getSupabaseClient>;
}

export function getRequestToken(request: NextRequest): string {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    || request.cookies.get('auth_token')?.value;

  if (!token) {
    throw new Error('未登录');
  }
  return token;
}

export async function getRequestUser(request: NextRequest): Promise<RequestUser> {
  const token = getRequestToken(request);
  const session = await verifyCurrentAuthSession(token);

  return {
    userId: session.userId,
    organizationId: session.organizationId,
    role: session.role,
    email: session.email,
    name: session.name,
    mustChangePassword: session.mustChangePassword,
    authVersion: session.authVersion,
    sessionId: session.sessionId,
  };
}

export async function createAuthenticatedSession(
  user: AuthenticatedUser,
): Promise<{ token: string; sessionId: string }> {
  const sessionId = randomUUID();
  const expiresAt = new Date(
    Date.now() + AUTH_SESSION_MAX_AGE_SECONDS * 1000,
  ).toISOString();
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from('auth_sessions').insert({
    id: sessionId,
    user_id: user.id,
    organization_id: user.organizationId,
    auth_version: user.authVersion,
    expires_at: expiresAt,
  });
  if (error) {
    throw new Error(`创建登录会话失败: ${error.message}`);
  }

  try {
    const token = await createAuthToken({ ...user, sessionId });
    return { token, sessionId };
  } catch (error) {
    await supabase.from('auth_sessions').delete().eq('id', sessionId);
    throw error;
  }
}

export async function revokeAuthSession(sessionId: string): Promise<void> {
  const { error } = await getSupabaseServiceClient()
    .from('auth_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', sessionId)
    .is('revoked_at', null);
  if (error) {
    throw new Error(`注销登录会话失败: ${error.message}`);
  }
}

export async function revokeAllAuthSessions(userId: string): Promise<void> {
  const { error } = await getSupabaseServiceClient()
    .from('auth_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null);
  if (error) {
    throw new Error(`撤销历史登录会话失败: ${error.message}`);
  }
}

export async function getTenantRequestContext(
  request: NextRequest,
): Promise<TenantRequestContext> {
  const user = await getRequestUser(request);
  const token = await createDatabaseAccessToken({
    id: user.userId,
    appRole: user.role,
    organizationId: user.organizationId,
  });
  return {
    token,
    user,
    supabase: getSupabaseClient(token),
  };
}

export async function getAdminRequestContext(
  request: NextRequest,
): Promise<TenantRequestContext> {
  const context = await getTenantRequestContext(request);
  if (context.user.role !== 'admin') {
    throw new Error('权限不足');
  }
  return context;
}
