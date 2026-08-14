import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenantRequestContext } from '@/lib/auth-server';
import { apiErrorResponse } from '@/lib/api-response';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  normalizeRecruitingApiError,
  parseStrictSearchParams,
} from '@/lib/recruiting/api-contracts';

const guidesListQuerySchema = z.strictObject({
  matchRecordId: z.string().trim().uuid('匹配记录ID格式无效'),
});

interface GuideTargetedQuestionRow {
  question?: unknown;
  origin?: unknown;
  dimension?: unknown;
}

// 读取某条匹配记录已生成的面试提纲（供结果录入关联使用，只返回专项题便于逐题打分）
export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.interviewGuideRead);
    const { searchParams } = new URL(request.url);
    const query = await parseStrictSearchParams(searchParams, guidesListQuerySchema);

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
      .from('interview_guides')
      .select('id, created_at, ai_mode, questions')
      .eq('match_record_id', query.matchRecordId)
      .eq('organization_id', user.organizationId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      throw new Error(`查询面试提纲失败: ${error.message}`);
    }

    const guides = (data ?? []).map((row) => {
      const rawQuestions: unknown[] = Array.isArray(row.questions?.targeted_questions)
        ? (row.questions.targeted_questions as unknown[])
        : [];
      const targetedQuestions: GuideTargetedQuestionRow[] = rawQuestions.map((item) => {
        const question = typeof item === 'object' && item !== null ? Reflect.get(item, 'question') : undefined;
        const origin = typeof item === 'object' && item !== null ? Reflect.get(item, 'origin') : undefined;
        const dimension = typeof item === 'object' && item !== null ? Reflect.get(item, 'dimension') : undefined;
        return {
          question: typeof question === 'string' ? question : null,
          origin: typeof origin === 'string' ? origin : null,
          dimension: typeof dimension === 'string' ? dimension : null,
        };
      });
      return {
        id: row.id,
        created_at: row.created_at,
        ai_mode: row.ai_mode,
        targeted_questions: targetedQuestions,
      };
    });

    return NextResponse.json({ success: true, data: guides });
  } catch (error) {
    return apiErrorResponse(
      normalizeRecruitingApiError(error, '获取面试提纲失败'),
      '获取面试提纲失败',
    );
  }
}
