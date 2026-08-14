import type { SupabaseClient } from '@supabase/supabase-js';

export const OUTREACH_TASK_STATUSES = [
  'pending',
  'contacted',
  'replied',
  'no_response',
  'closed',
] as const;

export type OutreachTaskStatus = (typeof OUTREACH_TASK_STATUSES)[number];

/** 新待办的默认截止时限：2 天 */
export const OUTREACH_DUE_DAYS = 2;

export interface OutreachTaskCreateInput {
  organizationId: string;
  userId: string;
  jobId: string;
  candidateId: string;
  matchRecordId?: string | null;
  shortlistEntryId?: string | null;
  dueAt?: string;
  scriptSnapshot?: string | null;
  note?: string | null;
}

/**
 * 幂等创建触达待办：同一 (职位, 候选人) 已存在未关闭任务时不重复创建。
 * 返回新建任务 ID；已有任务时返回 null。
 */
export async function ensureOutreachTask(
  supabase: SupabaseClient,
  input: OutreachTaskCreateInput,
): Promise<string | null> {
  const { data: existing, error: existingError } = await supabase
    .from('outreach_tasks')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('job_id', input.jobId)
    .eq('candidate_id', input.candidateId)
    .neq('status', 'closed')
    .maybeSingle();
  if (existingError) {
    throw new Error(`触达待办查询失败: ${existingError.message}`);
  }
  if (existing?.id) return null;

  const { data, error } = await supabase
    .from('outreach_tasks')
    .insert({
      organization_id: input.organizationId,
      job_id: input.jobId,
      candidate_id: input.candidateId,
      match_record_id: input.matchRecordId ?? null,
      shortlist_entry_id: input.shortlistEntryId ?? null,
      status: 'pending',
      due_at:
        input.dueAt
        ?? new Date(
          Date.now() + OUTREACH_DUE_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString(),
      script_snapshot: input.scriptSnapshot ?? null,
      note: input.note ?? null,
      created_by: input.userId,
    })
    .select('id')
    .single();
  if (error) {
    throw new Error(`创建触达待办失败: ${error.message}`);
  }
  return data.id;
}
