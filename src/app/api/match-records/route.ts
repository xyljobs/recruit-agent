import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { decryptField } from '@/lib/encryption';
import { getTenantRequestContext } from '@/lib/auth-server';
import { parseLimitedJson, SMALL_JSON_BODY_LIMIT } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';

interface MatchStatusEventRow {
  id: string;
  match_record_id: string;
  status: string;
  note: string | null;
  created_at: string;
}

// GET - 获取匹配记录
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId') || '';
    const status = searchParams.get('status') || '';
    const scoringStatus = searchParams.get('scoringStatus') || 'succeeded';

    if (!['pending', 'succeeded', 'failed', 'all'].includes(scoringStatus)) {
      return NextResponse.json(
        { success: false, error: '无效的评分状态' },
        { status: 400 },
      );
    }

    const { supabase, user } = await getTenantRequestContext(request);
    
    let query = supabase
      .from('match_records')
      .select(`
        *,
        job:job_requirements(id, title, department),
        candidate:candidates(id, name, email, phone, current_company, current_position)
      `)
      .eq('organization_id', user.organizationId)
      .order('overall_score', { ascending: false });

    if (jobId) {
      query = query.eq('job_id', jobId);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (scoringStatus !== 'all') {
      query = query.eq('scoring_status', scoringStatus);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`查询失败: ${error.message}`);
    }

    const matchRecordIds = (data || []).map(record => record.id);
    const statusHistories = new Map<
      string,
      Array<{ status: string; time: string; note?: string }>
    >();

    if (matchRecordIds.length > 0) {
      const { data: statusEvents, error: statusEventsError } = await supabase
        .from('match_status_events')
        .select('id, match_record_id, status, note, created_at')
        .eq('organization_id', user.organizationId)
        .in('match_record_id', matchRecordIds)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });

      if (statusEventsError) {
        throw new Error(`查询状态历史失败: ${statusEventsError.message}`);
      }

      for (const event of (statusEvents || []) as MatchStatusEventRow[]) {
        const history = statusHistories.get(event.match_record_id) || [];
        history.push({
          status: event.status,
          time: event.created_at,
          ...(event.note ? { note: event.note } : {}),
        });
        statusHistories.set(event.match_record_id, history);
      }
    }

    // 解密候选人加密字段
    const decryptedData = (data || []).map((record: Record<string, unknown>) => {
      const candidate = record.candidate as Record<string, unknown> | null;
      if (candidate) {
        candidate.name = decryptField(candidate.name as string) || candidate.name;
        candidate.email = decryptField(candidate.email as string) || candidate.email;
        candidate.phone = decryptField(candidate.phone as string) || candidate.phone;
        candidate.current_company = decryptField(candidate.current_company as string) || candidate.current_company;
        candidate.current_position = decryptField(candidate.current_position as string) || candidate.current_position;
      }
      return {
        ...record,
        status_history: statusHistories.get(record.id as string) || [],
      };
    });

    return NextResponse.json({
      success: true,
      data: decryptedData
    });

  } catch (error) {
    console.error('获取匹配记录失败:', error);
    return NextResponse.json(
      { error: '获取匹配记录失败' },
      { status: 500 }
    );
  }
}

// PATCH - 更新匹配状态
const legacyStatusUpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['contacted', 'interviewing', 'offered', 'hired', 'rejected', 'withdrawn']),
  note: z.string().trim().max(2000).optional(),
  reason_code: z.string().trim().min(1).max(100).optional(),
  client_event_id: z.string().uuid(),
  occurred_at: z.string().datetime({ offset: true }),
}).strict().superRefine((body, context) => {
  if (['rejected', 'withdrawn'].includes(body.status) && !body.reason_code) {
    context.addIssue({ code: 'custom', path: ['reason_code'], message: '终态状态更新必须提供原因' });
  }
});

export async function PATCH(request: NextRequest) {
  try {
    const body = await parseLimitedJson(request, legacyStatusUpdateSchema, SMALL_JSON_BODY_LIMIT);
    const { supabase } = await getTenantRequestContext(request);
    const eventType = {
      contacted: 'outreach_sent',
      interviewing: 'interview_scheduled',
      offered: 'offer',
      hired: 'hired',
      rejected: 'rejected',
      withdrawn: 'withdrawn',
    }[body.status];
    const { data, error } = await supabase.rpc(
      'record_recruiting_outcome',
      {
        p_match_record_id: body.id,
        p_event_type: eventType,
        p_source: 'human',
        p_client_event_id: body.client_event_id,
        p_occurred_at: body.occurred_at,
        p_reason_code: body.reason_code ?? null,
        p_note: body.note ?? null,
        p_target_stage: null,
        p_supersedes_event_id: null,
      },
    );

    if (error?.code === 'P0002') {
      return NextResponse.json(
        { success: false, error: '有效匹配记录不存在' },
        { status: 404 },
      );
    }
    if (error?.code === '22023') {
      return NextResponse.json(
        { success: false, error: '无效的招聘状态' },
        { status: 400 },
      );
    }

    if (error) {
      throw new Error(`更新失败: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      data
    });

  } catch (error) {
    return apiErrorResponse(error, '更新匹配状态失败');
  }
}
