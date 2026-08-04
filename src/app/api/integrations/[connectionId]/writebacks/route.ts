import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenantRequestContext } from '@/lib/auth-server';
import { SMALL_JSON_BODY_LIMIT, parseLimitedJson } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    outcome_event_id: z.string().uuid(),
    client_event_id: z.string().uuid(),
  }).strict(),
  z.object({ action: z.literal('cancel'), outbox_id: z.string().uuid() }).strict(),
  z.object({ action: z.literal('retry'), outbox_id: z.string().uuid() }).strict(),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await params;
    if (!z.string().uuid().safeParse(connectionId).success) {
      return NextResponse.json({ success: false, error: '数据源 ID 无效' }, { status: 400 });
    }
    const body = await parseLimitedJson(request, bodySchema, SMALL_JSON_BODY_LIMIT);
    const { supabase } = await getTenantRequestContext(request);
    const result = body.action === 'approve'
      ? await supabase.rpc('approve_integration_writeback', {
          p_connection_id: connectionId,
          p_outcome_event_id: body.outcome_event_id,
          p_client_event_id: body.client_event_id,
        })
      : await supabase.rpc('manage_integration_writeback', {
          p_outbox_id: body.outbox_id,
          p_action: body.action,
        });
    if (result.error?.code === '23505') {
      return NextResponse.json({ success: false, error: '幂等键已用于不同请求' }, { status: 409 });
    }
    if (result.error) throw new Error(`管理 ATS 回写失败: ${result.error.message}`);
    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    return apiErrorResponse(error, '管理 ATS 回写失败');
  }
}
