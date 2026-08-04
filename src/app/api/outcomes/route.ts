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
  recruitingOutcomeBodySchema,
  rpcErrorToRequestError,
} from '@/lib/recruiting/api-contracts';

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, { scope: 'outcomes:create' });
    const body = await parseLimitedJson(
      request,
      recruitingOutcomeBodySchema,
      SMALL_JSON_BODY_LIMIT,
    );
    if (body.event_type === 'stage_corrected' && user.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: '仅管理员可以更正招聘阶段' },
        { status: 403 },
      );
    }

    const rpcName = body.writeback_connection_id
      ? 'record_recruiting_outcome_with_writeback'
      : 'record_recruiting_outcome';
    const { data, error } = await supabase.rpc(rpcName, {
      p_match_record_id: body.match_record_id,
      p_event_type: body.event_type,
      p_source: body.event_type === 'stage_corrected' ? 'admin_correction' : 'human',
      p_client_event_id: body.client_event_id,
      p_occurred_at: body.occurred_at,
      p_reason_code: body.reason_code ?? null,
      p_note: body.note ?? null,
      p_target_stage: body.target_stage ?? null,
      p_supersedes_event_id: body.supersedes_event_id ?? null,
      ...(body.writeback_connection_id ? {
        p_connection_id: body.writeback_connection_id,
        p_writeback_client_event_id: body.writeback_client_event_id,
      } : {}),
    });
    if (error) throw rpcErrorToRequestError(error, '记录招聘结果失败');

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return apiErrorResponse(
      normalizeRecruitingApiError(error, '记录招聘结果失败'),
      '记录招聘结果失败',
    );
  }
}
