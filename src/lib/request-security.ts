import type { NextRequest } from 'next/server';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isHttpsRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    .trim()
    .toLowerCase();

  if (forwardedProto) {
    return forwardedProto === 'https';
  }

  if (request.nextUrl.protocol === 'https:') {
    return true;
  }

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    return false;
  }

  try {
    return new URL(appUrl).protocol === 'https:';
  } catch {
    throw new Error('APP_URL must be an absolute URL');
  }
}

function getAllowedOrigins(request: NextRequest): Set<string> {
  const origins = new Set<string>([request.nextUrl.origin]);
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    try {
      origins.add(new URL(appUrl).origin);
    } catch {
      throw new Error('APP_URL must be an absolute URL');
    }
  }

  return origins;
}

function requestSourceOrigin(request: NextRequest): string | null {
  const origin = request.headers.get('origin');
  if (origin) {
    return origin;
  }
  const referer = request.headers.get('referer');
  if (!referer) {
    return null;
  }
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function getRequestSecurityError(
  request: NextRequest,
  publicMutation: boolean,
): string | null {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) {
    return null;
  }

  const bearerToken = request.headers.get('authorization')?.match(/^Bearer\s+\S+$/i);
  const cookieToken = request.cookies.get('auth_token')?.value;
  const sourceOrigin = requestSourceOrigin(request);
  if (sourceOrigin) {
    if (!getAllowedOrigins(request).has(sourceOrigin)) {
      return '请求来源校验失败';
    }
  } else if (cookieToken || publicMutation) {
    return '请求缺少来源信息';
  }

  if (!cookieToken || bearerToken) {
    return null;
  }

  const csrfCookie = request.cookies.get('csrf_token')?.value ?? '';
  const csrfHeader = request.headers.get('x-csrf-token') ?? '';
  if (
    !csrfCookie
    || !constantTimeEqual(csrfCookie, csrfHeader)
  ) {
    return 'CSRF 校验失败';
  }
  return null;
}
