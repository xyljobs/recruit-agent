import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenantRequestContext } from '@/lib/auth-server';
import { apiErrorResponse } from '@/lib/api-response';
import { decryptField } from '@/lib/encryption';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { PROHIBITED_DISPLAY_TOPICS } from '@/lib/recruiting/interview-guide';
import {
  normalizeRecruitingApiError,
  parseStrictSearchParams,
} from '@/lib/recruiting/api-contracts';

const entryGuideQuerySchema = z.strictObject({
  shortlistEntryId: z.string().trim().uuid('短名单条目ID格式无效'),
});

interface GuideRow {
  id: string;
  ai_mode: string;
  focus_areas: unknown;
  questions: unknown;
  red_flags: unknown;
  interview_loop: unknown;
}

// 读取某条短名单条目最新生成的面试提纲（含人工编辑后的题目与答案），供独立页工作台加载
export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.interviewGuideRead);
    const { searchParams } = new URL(request.url);
    const query = await parseStrictSearchParams(searchParams, entryGuideQuerySchema);

    const { data: entry, error: entryError } = await supabase
      .from('shortlist_entries')
      .select('id, candidate_id')
      .eq('id', query.shortlistEntryId)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (entryError) {
      throw new Error(`查询短名单条目失败: ${entryError.message}`);
    }
    if (!entry) {
      return NextResponse.json(
        { success: false, error: '短名单条目不存在' },
        { status: 404 },
      );
    }

    const { data: guideRow, error: guideError } = await supabase
      .from('interview_guides')
      .select('id, ai_mode, focus_areas, questions, red_flags, interview_loop')
      .eq('shortlist_entry_id', query.shortlistEntryId)
      .eq('organization_id', user.organizationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (guideError) {
      throw new Error(`查询面试提纲失败: ${guideError.message}`);
    }
    if (!guideRow) {
      return NextResponse.json({ success: true, data: null });
    }

    const guide = guideRow as GuideRow;
    const rawQuestions = typeof guide.questions === 'object' && guide.questions !== null
      ? guide.questions
      : {};
    const commonQuestions = Array.isArray(Reflect.get(rawQuestions, 'common_questions'))
      ? (Reflect.get(rawQuestions, 'common_questions') as unknown[])
      : [];
    const targetedQuestions = Array.isArray(Reflect.get(rawQuestions, 'targeted_questions'))
      ? (Reflect.get(rawQuestions, 'targeted_questions') as unknown[])
      : [];

    const { data: candidateRow, error: candidateError } = await supabase
      .from('candidates')
      .select('name')
      .eq('id', entry.candidate_id)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (candidateError) {
      throw new Error(`查询候选人失败: ${candidateError.message}`);
    }
    const candidateName = decryptField(candidateRow?.name) ?? '候选人';

    return NextResponse.json({
      success: true,
      data: {
        guide: { id: guide.id, ai_mode: guide.ai_mode },
        content: {
          focus_areas: Array.isArray(guide.focus_areas) ? guide.focus_areas : [],
          common_questions: commonQuestions,
          targeted_questions: targetedQuestions,
          red_flags_to_check: Array.isArray(guide.red_flags) ? guide.red_flags : [],
          interview_loop: Array.isArray(guide.interview_loop) ? guide.interview_loop : [],
          prohibited_topics: [...PROHIBITED_DISPLAY_TOPICS],
        },
        candidate_name: candidateName,
      },
    });
  } catch (error) {
    return apiErrorResponse(
      normalizeRecruitingApiError(error, '获取面试提纲失败'),
      '获取面试提纲失败',
    );
  }
}
