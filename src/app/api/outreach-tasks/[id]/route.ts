import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseLimitedJson, SMALL_JSON_BODY_LIMIT } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { getTenantRequestContext } from '@/lib/auth-server';
import { OUTREACH_TASK_STATUSES } from '@/lib/outreach/tasks';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  normalizeRecruitingApiError,
  rpcErrorToRequestError,
} from '@/lib/recruiting/api-contracts';

const outreachPatchBodySchema = z.strictObject({
  status: z.enum(OUTREACH_TASK_STATUSES),
  note: z.string().trim().max(2000).optional(),
});

const outreachIdParamsSchema = z.strictObject({ id: z.string().trim().uuid('待办ID格式无效') });

// 待办状态 → 结果事件映射（与 outcomes 台账同一事件体系）
const STATUS_EVENT_MAP: Record<string, { event_type: string; reason_code?: string }> = {
  contacted: { event_type: 'outreach_sent' },
  replied: { event_type: 'candidate_replied' },
  no_response: { event_type: 'outreach_sent', reason_code: 'no_response' },
};

interface OutreachTaskRow {
  id: string;
  status: string;
  match_record_id: string | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const parsedParams = outreachIdParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: parsedParams.error.issues[0]?.message ?? '待办ID无效' },
        { status: 400 },
      );
    }
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.outreachUpdate);
    const body = await parseLimitedJson(
      request,
      outreachPatchBodySchema,
      SMALL_JSON_BODY_LIMIT,
    );

    const { data: task, error: taskError } = await supabase
      .from('outreach_tasks')
      .select('id, status, match_record_id')
      .eq('id', parsedParams.data.id)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (taskError) {
      throw new Error(`查询触达待办失败: ${taskError.message}`);
    }
    if (!task) {
      return NextResponse.json(
        { success: false, error: '触达待办不存在' },
        { status: 404 },
      );
    }
    const taskRow = task as OutreachTaskRow;

    const statusChanged = body.status !== taskRow.status;
    const { data: updated, error: updateError } = await supabase
      .from('outreach_tasks')
      .update({
        status: body.status,
        ...(body.note !== undefined ? { note: body.note || null } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskRow.id)
      .eq('organization_id', user.organizationId)
      .select('id, status, due_at, note')
      .single();
    if (updateError) {
      throw new Error(`更新触达待办失败: ${updateError.message}`);
    }

    // 状态变化且映射到结果事件时，按 outcomes 写入范式追加事件台账
    const eventMapping = STATUS_EVENT_MAP[body.status];
    if (statusChanged && eventMapping && taskRow.match_record_id) {
      const { error: outcomeError } = await supabase.rpc(
        'record_recruiting_outcome',
        {
          p_match_record_id: taskRow.match_record_id,
          p_event_type: eventMapping.event_type,
          p_source: 'human',
          p_client_event_id: randomUUID(),
          p_occurred_at: new Date().toISOString(),
          p_reason_code: eventMapping.reason_code ?? null,
          p_note: body.note ?? null,
        },
      );
      if (outcomeError) {
        throw rpcErrorToRequestError(outcomeError, '写入结果事件失败');
      }
    } else if (statusChanged && eventMapping && !taskRow.match_record_id) {
      console.warn('触达待办缺少匹配记录，仅更新任务状态，不写入结果事件');
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return apiErrorResponse(
      normalizeRecruitingApiError(error, '更新触达待办失败'),
      '更新触达待办失败',
    );
  }
}
