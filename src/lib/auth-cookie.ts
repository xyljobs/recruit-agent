import { randomBytes } from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { AUTH_SESSION_MAX_AGE_SECONDS } from '@/lib/auth-session';
import { isHttpsRequest } from '@/lib/request-security';

export const AUTH_COOKIE_NAME = 'auth_token';
export const CSRF_COOKIE_NAME = 'csrf_token';

export function setAuthCookies(
  response: NextResponse,
  request: NextRequest,
  token: string,
): void {
  const secure = isHttpsRequest(request);
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
    path: '/',
  });
  response.cookies.set(CSRF_COOKIE_NAME, randomBytes(32).toString('base64url'), {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
    path: '/',
  });
}

export function clearAuthCookies(response: NextResponse, request: NextRequest): void {
  const secure = isHttpsRequest(request);
  const options = {
    path: '/',
    expires: new Date(0),
    secure,
    sameSite: 'lax' as const,
  };
  response.cookies.set(AUTH_COOKIE_NAME, '', { ...options, httpOnly: true });
  response.cookies.set(CSRF_COOKIE_NAME, '', { ...options, httpOnly: false });
}
