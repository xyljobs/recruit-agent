import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiRequestError, parseLimitedJson, SMALL_JSON_BODY_LIMIT } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { getTenantRequestContext } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { assertNoProhibitedTopic } from '@/lib/recruiting/interview-guide';

const bankPatchBodySchema = z.strictObject({
  question: z.string().trim().min(1, '题目不能为空').max(500, '题目最多 500 字').optional(),
  dimension: z.string().trim().min(1, '考察点不能为空').max(50, '考察点最多 50 字').optional(),
  probe_followups: z.array(z.string().trim().min(1).max(200)).max(2).optional(),
  expected_signals: z.array(z.string().trim().min(1).max(200)).max(3).optional(),
  scoring_anchors: z.array(z.string().trim().min(1).max(200)).max(3).optional(),
  difficulty: z.enum(['基础', '进阶', '高级']).optional(),
  is_active: z.boolean().optional(),
}).refine(value => Object.keys(value).length > 0, {
  message: '请提供要更新的字段',
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, { scope: 'interview:bank:write' });
    const body = await parseLimitedJson(request, bankPatchBodySchema, SMALL_JSON_BODY_LIMIT);

    if (body.question) {
      assertNoProhibitedTopic(body.question);
    }

    const { data: existing, error: readError } = await supabase
      .from('interview_question_bank')
      .select('id, version, question')
      .eq('id', id)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (readError) throw new Error('面试题库读取失败');
    if (!existing) {
      throw new ApiRequestError('题库条目不存在', 404);
    }

    // 改题目原文时版本 +1（内容版本留痕，不改写历史）
    const questionChanged = body.question !== undefined && body.question !== existing.question;
    const { data, error } = await supabase
      .from('interview_question_bank')
      .update({
        ...(body.question !== undefined ? { question: body.question } : {}),
        ...(body.dimension !== undefined ? { dimension: body.dimension } : {}),
        ...(body.probe_followups !== undefined ? { probe_followups: body.probe_followups } : {}),
        ...(body.expected_signals !== undefined ? { expected_signals: body.expected_signals } : {}),
        ...(body.scoring_anchors !== undefined ? { scoring_anchors: body.scoring_anchors } : {}),
        ...(body.difficulty !== undefined ? { difficulty: body.difficulty } : {}),
        ...(body.is_active !== undefined ? { is_active: body.is_active } : {}),
        ...(questionChanged ? { version: existing.version + 1 } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('organization_id', user.organizationId)
      .select('id, scope, job_id, dimension, question, probe_followups, expected_signals, scoring_anchors, difficulty, is_active, version, updated_at')
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new ApiRequestError('该题目已存在于题库', 409);
      }
      throw new Error('面试题库更新失败');
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return apiErrorResponse(error, '面试题库更新失败');
  }
}
