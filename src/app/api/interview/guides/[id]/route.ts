import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenantRequestContext } from '@/lib/auth-server';
import { parseLimitedJson, SMALL_JSON_BODY_LIMIT } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  assertNoProhibitedTopic,
  interviewGuideQuestionsSchema,
} from '@/lib/recruiting/interview-guide';
import {
  normalizeRecruitingApiError,
  rpcErrorToRequestError,
} from '@/lib/recruiting/api-contracts';

const updateGuideBodySchema = z.strictObject({
  questions: interviewGuideQuestionsSchema,
});

// 保存 HR 对面试提纲的编辑（题目增删改 + 面试答案），整包写回 questions JSONB
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: guideId } = await params;
    const { supabase } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.interviewGuideWrite);

    const body = await parseLimitedJson(request, updateGuideBodySchema, SMALL_JSON_BODY_LIMIT);

    for (const item of body.questions.common_questions) {
      assertNoProhibitedTopic(item.question);
    }
    for (const item of body.questions.targeted_questions) {
      assertNoProhibitedTopic(item.question);
      for (const followup of item.probe_followups) {
        assertNoProhibitedTopic(followup);
      }
    }

    const { data, error } = await supabase.rpc('update_interview_guide', {
      p_guide_id: guideId,
      p_questions: body.questions,
    });
    if (error) {
      throw rpcErrorToRequestError(error, '保存面试提纲失败');
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return apiErrorResponse(
      normalizeRecruitingApiError(error, '保存面试提纲失败'),
      '保存面试提纲失败',
    );
  }
}
