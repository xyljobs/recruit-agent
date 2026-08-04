import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenantRequestContext } from '@/lib/auth-server';
import { SMALL_JSON_BODY_LIMIT, parseLimitedJson } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    candidate_id: z.string().uuid(),
    request_type: z.enum(['withdraw', 'delete', 'explain', 'object', 'complaint']),
    received_at: z.string().datetime({ offset: true }),
    due_at: z.string().datetime({ offset: true }),
    source_reference: z.string().trim().min(1).max(500).optional(),
  }).strict(),
  z.object({
    action: z.literal('update'),
    request_id: z.string().uuid(),
    status: z.enum(['in_progress', 'resolved', 'rejected']),
    resolution_reference: z.string().trim().min(1).max(500).optional(),
  }).strict(),
]);

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    const { data, error } = await supabase
      .from('candidate_rights_requests')
      .select('id,analytics_subject_id,request_type,status,source_reference,resolution_reference,received_at,due_at,resolved_at,created_at,updated_at')
      .eq('organization_id', user.organizationId)
      .order('due_at', { ascending: true })
      .limit(500);
    if (error) throw new Error(`读取候选人权利请求失败: ${error.message}`);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return apiErrorResponse(error, '读取候选人权利请求失败');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseLimitedJson(request, bodySchema, SMALL_JSON_BODY_LIMIT);
    const { supabase } = await getTenantRequestContext(request);
    const result = body.action === 'create'
      ? await supabase.rpc('record_candidate_rights_request', {
          p_candidate_id: body.candidate_id,
          p_request_type: body.request_type,
          p_received_at: body.received_at,
          p_due_at: body.due_at,
          p_source_reference: body.source_reference ?? null,
        })
      : await supabase.rpc('resolve_candidate_rights_request', {
          p_request_id: body.request_id,
          p_status: body.status,
          p_resolution_reference: body.resolution_reference ?? null,
        });
    if (result.error) throw new Error(`处理候选人权利请求失败: ${result.error.message}`);
    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    return apiErrorResponse(error, '处理候选人权利请求失败');
  }
}
