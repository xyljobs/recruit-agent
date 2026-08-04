import { NextRequest, NextResponse } from 'next/server';
import {
  assertBossTaskAccess,
  BossTaskFileError,
  getBossRequestContext,
} from '@/lib/boss-search-task-files';

/**
 * POST /api/boss-search/report
 * 
 * Web 应用端：标记 report_requested=true，本地 Worker 检测到后打开桌面报告。
 * 不在服务端读取本地文件系统或 spawn 进程。
 */
export async function POST(request: NextRequest) {
  try {
    const context = await getBossRequestContext(request);
    const body = await request.json() as { taskId?: string; task_id?: string };

    // 支持 taskId 和 task_id 两种参数名
    const taskId = body.taskId || body.task_id;

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: '请提供任务ID' },
        { status: 400 }
      );
    }

    // 检查任务是否存在且已完成
    const { data: task, error: fetchError } = await context.supabase
      .from('boss_search_tasks')
      .select('id, user_id, status, task_dir')
      .eq('id', taskId)
      .eq('organization_id', context.organizationId)
      .single();

    if (fetchError || !task) {
      return NextResponse.json(
        { success: false, error: '任务不存在' },
        { status: 404 }
      );
    }
    assertBossTaskAccess(context, task.user_id);

    if (task.status !== 'done') {
      return NextResponse.json(
        { success: false, error: '任务尚未完成，无法生成报告' },
        { status: 400 }
      );
    }

    // 标记报告请求
    const { error: updateError } = await context.supabase
      .from('boss_search_tasks')
      .update({
        report_requested: true,
        report_status: 'requested',
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId)
      .eq('organization_id', context.organizationId);

    if (updateError) {
      return NextResponse.json(
        { success: false, error: `更新报告状态失败: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        mode: 'worker_request',
        message: '本地 Worker 会在桌面打开报告窗口',
        taskId,
      },
    });
  } catch (error) {
    if (error instanceof BossTaskFileError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status },
      );
    }
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json(
      { success: false, error: `报告请求失败: ${message}` },
      { status: 500 }
    );
  }
}
