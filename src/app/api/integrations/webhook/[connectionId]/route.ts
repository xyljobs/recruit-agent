import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiRequestError } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { decrypt } from '@/lib/encryption';
import { INTEGRATION_BODY_LIMIT, verifyWebhookSignature } from '@/lib/integrations/webhook';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';

const eventSchema = z.object({
  external_event_id: z.string().trim().min(1).max(200),
  match_record_id: z.string().uuid(),
  event_type: z.enum([
    'outreach_sent', 'candidate_replied', 'interview_scheduled',
    'interview_completed', 'qualified_interview', 'offer', 'hired',
    'rejected', 'withdrawn', 'complaint',
  ]),
  occurred_at: z.string().datetime({ offset: true }),
  reason_code: z.string().trim().min(1).max(100).optional(),
  note: z.string().trim().max(1000).optional(),
}).strict().superRefine((event, context) => {
  if (['rejected', 'withdrawn'].includes(event.event_type) && !event.reason_code) {
    context.addIssue({ code: 'custom', path: ['reason_code'], message: '终态事件必须提供原因' });
  }
});
const webhookSchema = z.object({ events: z.array(eventSchema).min(1).max(100) }).strict();

async function readRawBody(request: Request): Promise<string> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > INTEGRATION_BODY_LIMIT) {
    throw new ApiRequestError('Webhook 请求体不能超过 1 MiB', 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiRequestError('Webhook 请求体不能为空', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > INTEGRATION_BODY_LIMIT) {
      await reader.cancel();
      throw new ApiRequestError('Webhook 请求体不能超过 1 MiB', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await params;
    if (!z.string().uuid().safeParse(connectionId).success) {
      throw new ApiRequestError('数据源 ID 无效', 400);
    }
    const rawBody = await readRawBody(request);
    const service = getSupabaseServiceClient();
    const { data: connection, error: connectionError } = await service
      .from('integration_connections')
      .select('id, organization_id, status, capabilities, webhook_secret_encrypted')
      .eq('id', connectionId)
      .single();
    if (connectionError || !connection || connection.status !== 'enabled') {
      throw new ApiRequestError('Webhook 数据源不可用', 404);
    }
    const capabilities = Array.isArray(connection.capabilities) ? connection.capabilities : [];
    if (!capabilities.includes('inbound_outcomes')) {
      throw new ApiRequestError('该数据源未授权接收招聘结果', 403);
    }
    const secret = decrypt(connection.webhook_secret_encrypted);
    if (!secret || secret === '[解密失败]' || !verifyWebhookSignature({
      secret,
      timestamp: request.headers.get('x-zhipin-timestamp'),
      signature: request.headers.get('x-zhipin-signature'),
      raw_body: rawBody,
    })) {
      throw new ApiRequestError('Webhook 签名无效或已过期', 401);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new ApiRequestError('Webhook 请求体必须是有效 JSON', 400);
    }
    const body = webhookSchema.safeParse(parsed);
    if (!body.success) throw new ApiRequestError(body.error.issues[0]?.message ?? 'Webhook 事件无效', 400);
    const results: unknown[] = [];
    for (const event of body.data.events) {
      const { data, error } = await service.rpc('record_authorized_ats_outcome', {
        p_organization_id: connection.organization_id,
        p_connection_id: connection.id,
        p_match_record_id: event.match_record_id,
        p_event_type: event.event_type,
        p_external_event_id: event.external_event_id,
        p_occurred_at: event.occurred_at,
        p_reason_code: event.reason_code ?? null,
        p_note: event.note ?? null,
      });
      if (error?.code === '23505') throw new ApiRequestError('外部事件 ID 已用于不同载荷', 409);
      if (error) throw new Error(`写入 ATS 结果失败: ${error.message}`);
      results.push(data);
    }
    return NextResponse.json({ success: true, data: { events: results } });
  } catch (error) {
    return apiErrorResponse(error, '处理 ATS Webhook 失败');
  }
}
