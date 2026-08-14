import { NextRequest, NextResponse } from 'next/server';
import { getTenantRequestContext } from '@/lib/auth-server';
import {
  parseLimitedJson,
  SMALL_JSON_BODY_LIMIT,
} from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { enforceRateLimit } from '@/lib/rate-limit';
import { shortlistDecisionSchema } from '@/lib/matching/shortlist';
import { ensureOutreachTask } from '@/lib/outreach/tasks';
import {
  normalizeRecruitingApiError,
  rpcErrorToRequestError,
  shortlistEntryParamsSchema,
} from '@/lib/recruiting/api-contracts';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; entryId: string }> },
) {
  try {
    const parsedParams = shortlistEntryParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: parsedParams.error.issues[0]?.message ?? '短名单条目ID无效' },
        { status: 400 },
      );
    }
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, { scope: 'shortlists:decision' });
    const body = await parseLimitedJson(
      request,
      shortlistDecisionSchema,
      SMALL_JSON_BODY_LIMIT,
    );

    const { data: entry, error: entryError } = await supabase
      .from('shortlist_entries')
      .select('id, candidate_id, match_record_id, shortlist_run_id')
      .eq('id', parsedParams.data.entryId)
      .eq('shortlist_run_id', parsedParams.data.runId)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (entryError) throw new Error('shortlist entry read failed');
    if (!entry) {
      return NextResponse.json(
        { success: false, error: '短名单条目不存在' },
        { status: 404 },
      );
    }

    // 决策 accepted 时需要职位与话术快照以自动生成触达待办
    const { data: run, error: runError } = await supabase
      .from('shortlist_runs')
      .select('job_id')
      .eq('id', entry.shortlist_run_id)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (runError || !run?.job_id) {
      throw new Error('shortlist run read failed');
    }
    let scriptSnapshot: string | null = null;
    if (body.decision === 'accepted' && entry.match_record_id) {
      const { data: matchRecord } = await supabase
        .from('match_records')
        .select('generated_script')
        .eq('id', entry.match_record_id)
        .eq('organization_id', user.organizationId)
        .maybeSingle();
      scriptSnapshot = matchRecord?.generated_script ?? null;
    }

    const { data, error } = await supabase.rpc('record_shortlist_decision', {
      p_shortlist_entry_id: parsedParams.data.entryId,
      p_decision: body.decision,
      p_reason_code: body.reason_code ?? null,
      p_note: body.note ?? null,
      p_client_event_id: body.client_event_id,
      p_occurred_at: body.occurred_at,
    });
    if (error) throw rpcErrorToRequestError(error, '记录人工决策失败');

    // 决策通过 → 自动生成触达待办（同职位+候选人已有未关闭任务时幂等跳过）
    if (body.decision === 'accepted') {
      await ensureOutreachTask(supabase, {
        organizationId: user.organizationId,
        userId: user.userId,
        jobId: run.job_id,
        candidateId: entry.candidate_id,
        matchRecordId: entry.match_record_id,
        shortlistEntryId: parsedParams.data.entryId,
        scriptSnapshot,
      });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return apiErrorResponse(
      normalizeRecruitingApiError(error, '记录人工决策失败'),
      '记录人工决策失败',
    );
  }
}
