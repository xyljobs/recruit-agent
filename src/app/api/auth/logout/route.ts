import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { clearAuthCookies } from '@/lib/auth-cookie';
import { getRequestUser, revokeAuthSession } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    await revokeAuthSession(user.sessionId);
  } catch {
    // 会话已经失效时仍需清除浏览器端凭据。
  }

  const response = NextResponse.json({
    success: true,
    message: '已退出登录',
  });
  clearAuthCookies(response, request);
  return response;
}
