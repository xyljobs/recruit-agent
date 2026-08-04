import { NextRequest, NextResponse } from 'next/server';
import { getTenantRequestContext } from '@/lib/auth-server';
import {
  bossExecuteBodySchema,
  JD_JSON_BODY_LIMIT,
  parseLimitedJson,
} from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * POST /api/boss-search/execute
 * 
 * Web 应用只创建任务记录，不执行任何本地命令。
 * 本地 Worker 会轮询 boss_search_tasks 表认领 pending 任务。
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.bossExecute);
    const body = await parseLimitedJson(
      request,
      bossExecuteBodySchema,
      JD_JSON_BODY_LIMIT,
    );
    const keywords = body.keywords;
    const expectedCount = keywords.reduce((sum, keyword) => sum + keyword.count, 0);
    const { data, error } = await supabase
      .from('boss_search_tasks')
      .insert({
        organization_id: user.organizationId,
        user_id: user.userId,
        jd_content: body.jdContent,
        city: body.city || null,
        keywords,
        status: 'pending',
        expected_count: expectedCount,
      })
      .select('id, status')
      .single();

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: `创建搜索任务失败: ${error?.message || '未知错误'}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        taskId: data.id,
        status: data.status,
        expectedCount,
      },
    });
  } catch (error) {
    console.error('搜索任务创建失败:', error);
    return apiErrorResponse(error, '搜索任务创建失败');
  }
}
