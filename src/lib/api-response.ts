import { NextResponse } from 'next/server';
import { ApiRequestError } from '@/lib/api-limits';

export function apiErrorResponse(error: unknown, fallbackMessage: string): NextResponse {
  if (error instanceof ApiRequestError) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: error.status, headers: error.headers },
    );
  }

  // 服务端意外错误必须留痕，并把真实原因透传给前端（私有部署，错误信息不含密钥），
  // 否则根因（如存储瞬断、缺列）只落日志，前端只能看到笼统文案、无法自助排查
  const detail = error instanceof Error ? error.message : '';
  console.error(
    `[API] ${fallbackMessage}:`,
    error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : error,
  );

  return NextResponse.json(
    { success: false, error: detail || fallbackMessage },
    { status: 500 },
  );
}
