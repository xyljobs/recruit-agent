import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenantRequestContext } from '@/lib/auth-server';
import {
  parseLimitedJson,
  SMALL_JSON_BODY_LIMIT,
} from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  normalizeRecruitingApiError,
  parseStrictSearchParams,
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

    // 面试反馈可关联提纲：校验提纲属于本组织且对应同一条匹配记录，题目命中结果与提纲一致
    const guideId = typeof body.metadata?.interview_guide_id === 'string'
      ? body.metadata.interview_guide_id
      : null;
    if (guideId) {
      const { data: guideRow, error: guideError } = await supabase
        .from('interview_guides')
        .select('questions')
        .eq('id', guideId)
        .eq('organization_id', user.organizationId)
        .eq('match_record_id', body.match_record_id)
        .maybeSingle();
      if (guideError) {
        throw new Error(`查询面试提纲失败: ${guideError.message}`);
      }
      if (!guideRow) {
        return NextResponse.json(
          { success: false, error: '面试提纲不存在或与当前匹配记录不一致' },
          { status: 400 },
        );
      }
      const questionResults = Array.isArray(body.metadata?.question_results)
        ? body.metadata.question_results
        : [];
      if (questionResults.length > 0) {
        const guideQuestions = Array.isArray(guideRow.questions?.targeted_questions)
          ? guideRow.questions.targeted_questions
          : [];
        const questionByText = new Map<string, { origin?: unknown }>();
        for (const item of guideQuestions) {
          if (typeof item?.question === 'string') {
            questionByText.set(item.question, { origin: item.origin });
          }
        }
        for (const result of questionResults) {
          const expected = questionByText.get(result.question);
          if (!expected || expected.origin !== result.origin) {
            return NextResponse.json(
              { success: false, error: '题目命中结果与关联提纲不一致' },
              { status: 400 },
            );
          }
        }
      }
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
      p_metadata: body.metadata ?? null,
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

const outcomesListQuerySchema = z.strictObject({
  matchRecordId: z.string().trim().uuid('匹配记录ID格式无效'),
});

interface OutcomeEventRow {
  id: string;
  event_type: string;
  target_stage: string | null;
  reason_code: string | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
  recorded_at: string;
}

// 读取某条匹配记录的结果事件台账（含 metadata），供「当前候选人进展」卡展示面试安排等明细
export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.outcomesRead);
    const { searchParams } = new URL(request.url);
    const query = await parseStrictSearchParams(searchParams, outcomesListQuerySchema);

    const { data: record, error: recordError } = await supabase
      .from('match_records')
      .select('id')
      .eq('id', query.matchRecordId)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (recordError) {
      throw new Error(`查询匹配记录失败: ${recordError.message}`);
    }
    if (!record) {
      return NextResponse.json(
        { success: false, error: '匹配记录不存在' },
        { status: 404 },
      );
    }

    const { data, error } = await supabase
      .from('recruiting_outcome_events')
      .select('id, event_type, target_stage, reason_code, note, metadata, occurred_at, recorded_at')
      .eq('match_record_id', query.matchRecordId)
      .eq('organization_id', user.organizationId)
      .order('occurred_at', { ascending: true })
      .limit(200);
    if (error) {
      throw new Error(`查询结果事件失败: ${error.message}`);
    }

    return NextResponse.json({ success: true, data: (data ?? []) as unknown as OutcomeEventRow[] });
  } catch (error) {
    return apiErrorResponse(
      normalizeRecruitingApiError(error, '获取结果事件失败'),
      '获取结果事件失败',
    );
  }
}
