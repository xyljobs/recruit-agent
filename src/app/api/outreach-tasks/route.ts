import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseLimitedJson, SMALL_JSON_BODY_LIMIT } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { getTenantRequestContext } from '@/lib/auth-server';
import { decryptField } from '@/lib/encryption';
import {
  ensureOutreachTask,
} from '@/lib/outreach/tasks';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const outreachCreateBodySchema = z.strictObject({
  jobId: z.string().trim().uuid('职位ID格式无效'),
  candidateId: z.string().trim().uuid('候选人ID格式无效'),
  matchRecordId: z.string().trim().uuid('匹配记录ID格式无效').optional(),
});

// 脱敏姓名：张**三
function maskName(name: string | null): string {
  if (!name) return '未知';
  if (name.length <= 1) return name;
  if (name.length === 2) return name[0] + '*';
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
}

interface OutreachTaskRow {
  id: string;
  job_id: string;
  candidate_id: string;
  match_record_id: string | null;
  status: string;
  due_at: string;
  script_snapshot: string | null;
  note: string | null;
  created_at: string;
  job: { title: string | null } | null;
  candidate: { name: string | null } | null;
}

// GET - 未关闭的触达待办（按截止时间升序，候选人姓名脱敏）
export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.outreachList);
    const { data, error } = await supabase
      .from('outreach_tasks')
      .select(
        'id, job_id, candidate_id, match_record_id, status, due_at, script_snapshot, note, created_at, job:job_requirements!outreach_tasks_job_id_fkey(title), candidate:candidates!outreach_tasks_candidate_id_fkey(name)',
      )
      .eq('organization_id', user.organizationId)
      .neq('status', 'closed')
      .order('due_at', { ascending: true })
      .limit(100);
    if (error) {
      throw new Error(`查询触达待办失败: ${error.message}`);
    }

    const tasks = ((data ?? []) as unknown as OutreachTaskRow[]).map((task) => ({
      id: task.id,
      job_id: task.job_id,
      candidate_id: task.candidate_id,
      match_record_id: task.match_record_id,
      status: task.status,
      due_at: task.due_at,
      script_snapshot: task.script_snapshot,
      note: task.note,
      created_at: task.created_at,
      candidate_name: maskName(decryptField(task.candidate?.name ?? null)),
      job_title: task.job?.title ?? '职位',
    }));

    return NextResponse.json({ success: true, data: tasks });
  } catch (error) {
    return apiErrorResponse(error, '获取触达待办失败');
  }
}

// POST - 手动创建触达待办（人才池再激活等场景复用）
export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.outreachCreate);
    const body = await parseLimitedJson(
      request,
      outreachCreateBodySchema,
      SMALL_JSON_BODY_LIMIT,
    );

    const { data: job } = await supabase
      .from('job_requirements')
      .select('id')
      .eq('id', body.jobId)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (!job) {
      return NextResponse.json(
        { success: false, error: '职位不存在' },
        { status: 404 },
      );
    }

    const { data: candidate } = await supabase
      .from('candidates')
      .select('id')
      .eq('id', body.candidateId)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (!candidate) {
      return NextResponse.json(
        { success: false, error: '候选人不存在' },
        { status: 404 },
      );
    }

    let matchRecordId: string | null = null;
    if (body.matchRecordId) {
      const { data: matchRecord } = await supabase
        .from('match_records')
        .select('id')
        .eq('id', body.matchRecordId)
        .eq('organization_id', user.organizationId)
        .eq('job_id', body.jobId)
        .eq('candidate_id', body.candidateId)
        .maybeSingle();
      if (!matchRecord) {
        return NextResponse.json(
          { success: false, error: '匹配记录不存在或与职位/候选人不符' },
          { status: 404 },
        );
      }
      matchRecordId = body.matchRecordId;
    }

    const createdId = await ensureOutreachTask(supabase, {
      organizationId: user.organizationId,
      userId: user.userId,
      jobId: body.jobId,
      candidateId: body.candidateId,
      matchRecordId,
    });

    return NextResponse.json({
      success: true,
      data: { created: createdId !== null },
    });
  } catch (error) {
    return apiErrorResponse(error, '创建触达待办失败');
  }
}
