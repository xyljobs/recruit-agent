/**
 * 客户端认证工具
 * 
 * 在 iframe 预览环境中，浏览器可能阻止第三方 cookie（SameSite=none），
 * 导致 HttpOnly cookie 无法存储。因此同时支持 token-based auth：
 * - 登录后将 token 存入 sessionStorage
 * - 所有 API 请求通过 Authorization header 携带 token
 * - cookie 和 Authorization header 双通道，任一可用即可
 */

import { withBasePath } from '@/lib/base-path';

const TOKEN_KEY = 'auth_token';
const CSRF_COOKIE_NAME = 'csrf_token';

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(TOKEN_KEY);
}

/**
 * 带 Authorization header 的 fetch 封装
 * 自动从 sessionStorage 读取 token 并附加到请求头
 * 同时保留 credentials: 'include' 以兼容 cookie 认证
 */
export async function authFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init?.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const method = (init?.method ?? 'GET').toUpperCase();
  if (
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    && !headers.has('X-CSRF-Token')
    && typeof document !== 'undefined'
  ) {
    const csrfCookie = document.cookie
      .split('; ')
      .find(cookie => cookie.startsWith(`${CSRF_COOKIE_NAME}=`));
    if (csrfCookie) {
      headers.set('X-CSRF-Token', decodeURIComponent(csrfCookie.split('=').slice(1).join('=')));
    }
  }
  return fetch(withBasePath(input), {
    ...init,
    headers,
    credentials: 'include',
  });
}
