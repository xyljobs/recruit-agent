import { NextRequest, NextResponse } from 'next/server';
import { getTenantRequestContext } from '@/lib/auth-server';
import { apiErrorResponse } from '@/lib/api-response';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  normalizeRecruitingApiError,
  routeIdParamsSchema,
} from '@/lib/recruiting/api-contracts';

const STATUS_FIELDS =
  'id,status,candidate_count,error_message,requested_at,completed_at,progress' as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const parsedParams = routeIdParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: parsedParams.error.issues[0]?.message ?? '短名单ID无效' },
        { status: 400 },
      );
    }
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, { scope: 'shortlists:read' });

    const { data, error } = await supabase
      .from('shortlist_runs')
      .select(STATUS_FIELDS)
      .eq('id', parsedParams.data.runId)
      .eq('organization_id', user.organizationId)
      .maybeSingle();

    if (error) throw new Error('shortlist status read failed');
    if (!data) {
      return NextResponse.json(
        { success: false, error: '短名单不存在' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        runId: data.id,
        status: data.status,
        candidateCount: data.candidate_count,
        errorMessage: data.error_message,
        requestedAt: data.requested_at,
        completedAt: data.completed_at,
        progress: data.progress,
      },
    });
  } catch (error) {
    return apiErrorResponse(
      normalizeRecruitingApiError(error, '获取短名单进度失败'),
      '获取短名单进度失败',
    );
  }
}
