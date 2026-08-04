import { NextRequest, NextResponse } from 'next/server';
import { getTenantRequestContext } from '@/lib/auth-server';
import {
  parseLimitedJson,
  SMALL_JSON_BODY_LIMIT,
} from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  normalizeRecruitingApiError,
  routeIdParamsSchema,
  rpcErrorToRequestError,
  shortlistQualificationBodySchema,
} from '@/lib/recruiting/api-contracts';

export async function PATCH(
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
    const { supabase } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, { scope: 'shortlists:qualify' });
    const body = await parseLimitedJson(
      request,
      shortlistQualificationBodySchema,
      SMALL_JSON_BODY_LIMIT,
    );
    const { data, error } = await supabase.rpc('qualify_shortlist_run', {
      p_shortlist_run_id: parsedParams.data.runId,
      p_client_event_id: body.client_event_id,
    });
    if (error) throw rpcErrorToRequestError(error, '确认合格短名单失败');

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return apiErrorResponse(
      normalizeRecruitingApiError(error, '确认合格短名单失败'),
      '确认合格短名单失败',
    );
  }
}
