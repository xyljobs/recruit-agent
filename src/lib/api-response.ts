import { NextResponse } from 'next/server';
import { ApiRequestError } from '@/lib/api-limits';

export function apiErrorResponse(error: unknown, fallbackMessage: string): NextResponse {
  if (error instanceof ApiRequestError) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: error.status, headers: error.headers },
    );
  }

  return NextResponse.json(
    { success: false, error: fallbackMessage },
    { status: 500 },
  );
}
