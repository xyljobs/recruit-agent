import { NextRequest, NextResponse } from 'next/server';
import { verifyCurrentAuthSession } from '@/lib/auth-session';
import { getRequestSecurityError } from '@/lib/request-security';

// 公开路径（无需登录）
const publicPaths = new Set(['/login', '/api/auth/login', '/api/auth/register']);
const publicApiPrefixes = ['/api/integrations/webhook/'];
const passwordChangePaths = new Set([
  '/change-password',
  '/api/auth/change-password',
  '/api/auth/logout',
  '/api/auth/me',
]);

/**
 * RBAC 权限映射
 * - admin:  全部权限（用户管理 + 业务操作）
 * - hr:     业务操作（JD解析、候选人、匹配、话术、看板）
 * - system: 系统级操作（审计日志、数据统计，不允许业务操作）
 *
 * API 路径 → 允许访问的角色列表
 */
const rolePermissions: Record<string, string[]> = {
  // 审计/系统类 — admin + system
  // (暂无独立审计 API，预留)

  // 业务类 — admin + hr
  '/api/auth/invitations': ['admin'],
  '/api/resume-batch/admin': ['admin'],
  '/api/resume-batch': ['admin', 'hr'],
  '/api/jd/parse': ['admin', 'hr'],
  '/api/jobs': ['admin', 'hr'],
  '/api/candidates': ['admin', 'hr'],
  '/api/match': ['admin', 'hr'],
  '/api/match-records': ['admin', 'hr'],
  '/api/script/generate': ['admin', 'hr'],
  '/api/search': ['admin', 'hr'],
  '/api/dashboard': ['admin', 'hr', 'system'],
};

function getRequiredRoles(pathname: string): string[] | null {
  // 精确匹配 + 前缀匹配
  for (const [prefix, roles] of Object.entries(rolePermissions)) {
    if (pathname.startsWith(prefix)) {
      return roles;
    }
  }
  // 未配置的 API 路由默认 admin + hr
  if (pathname.startsWith('/api/')) {
    return ['admin', 'hr'];
  }
  // 页面路由不限制角色
  return null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicMutation = pathname === '/api/auth/login' || pathname === '/api/auth/register';
  if (pathname.startsWith('/api/')) {
    const securityError = getRequestSecurityError(request, isPublicMutation);
    if (securityError) {
      return NextResponse.json(
        { success: false, error: securityError },
        { status: 403 },
      );
    }
  }

  // 检查是否为公开路径
  if (
    publicPaths.has(pathname)
    || publicApiPrefixes.some(prefix => pathname.startsWith(prefix))
  ) {
    // 如果已登录，访问登录页时重定向到首页
    if (pathname === '/login') {
      const token = request.cookies.get('auth_token')?.value;
      if (token) {
        try {
          const session = await verifyCurrentAuthSession(token);
          const destination = session.mustChangePassword ? '/change-password' : '/';
          return NextResponse.redirect(new URL(destination, request.url));
        } catch {
          // token无效，继续显示登录页
        }
      }
    }
    return NextResponse.next();
  }

  // 静态资源跳过
  if (pathname.startsWith('/_next')) {
    return NextResponse.next();
  }

  // 验证登录状态
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    || request.cookies.get('auth_token')?.value;

  if (!token) {
    // API路由返回401 JSON，页面路由重定向到登录页
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: '未登录，请先登录', authenticated: false },
        { status: 401 }
      );
    }
    // iframe 预览可能禁用第三方 Cookie；页面外壳不含敏感数据，
    // 客户端会用 sessionStorage 中的 Bearer token 调用受保护 API 完成校验。
    return NextResponse.next();
  }

  try {
    const session = await verifyCurrentAuthSession(token);

    if (session.mustChangePassword && !passwordChangePaths.has(pathname)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          {
            success: false,
            error: '首次登录必须修改密码',
            passwordChangeRequired: true,
          },
          { status: 403 }
        );
      }
      return NextResponse.redirect(new URL('/change-password', request.url));
    }

    // RBAC: 检查角色权限
    const requiredRoles = getRequiredRoles(pathname);
    if (requiredRoles) {
      if (!requiredRoles.includes(session.role)) {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json(
            { error: '权限不足，无法访问该资源', forbidden: true },
            { status: 403 }
          );
        }
        return NextResponse.redirect(new URL('/', request.url));
      }
    }

    return NextResponse.next();
  } catch {
    // API路由返回401 JSON，页面路由重定向到登录页
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: '登录已过期，请重新登录', authenticated: false },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
};
