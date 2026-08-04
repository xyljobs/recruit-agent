import { NextRequest, NextResponse } from 'next/server';
import { getTenantRequestContext } from '@/lib/auth-server';

interface TaskFile {
  name?: unknown;
  size?: unknown;
}

function taskResponse(task: Record<string, unknown>) {
  const files = Array.isArray(task.files) ? task.files as TaskFile[] : [];
  return {
    taskId: task.id,
    sheetName: task.sheet_name,
    status: task.status,
    overwrite: task.overwrite,
    dryRun: task.dry_run,
    files: files.map(file => ({
      name: typeof file.name === 'string' ? file.name : '未知文件',
      size: typeof file.size === 'number' ? file.size : 0,
    })),
    logs: Array.isArray(task.logs)
      ? task.logs.filter((line): line is string => typeof line === 'string')
      : [],
    result: task.result,
    errorMessage: task.error_message,
    createdAt: task.created_at,
    startedAt: task.started_at,
    finishedAt: task.finished_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    const taskId = request.nextUrl.searchParams.get('taskId');

    if (taskId) {
      let query = supabase
        .from('resume_batch_tasks')
        .select('*')
        .eq('id', taskId)
        .eq('organization_id', user.organizationId);
      if (user.role !== 'admin') {
        query = query.eq('user_id', user.userId);
      }
      const { data: task, error } = await query.single();
      if (error || !task) {
        return NextResponse.json(
          { success: false, error: '任务不存在或无权查看' },
          { status: 404 },
        );
      }
      return NextResponse.json({
        success: true,
        data: taskResponse(task),
      });
    }

    let query = supabase
      .from('resume_batch_tasks')
      .select('*')
      .eq('organization_id', user.organizationId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (user.role !== 'admin') {
      query = query.eq('user_id', user.userId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      success: true,
      data: (data || []).map(task => taskResponse(task)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    const status = message === '未登录' || message === '登录信息无效' ? 401 : 500;
    return NextResponse.json(
      { success: false, error: `读取任务状态失败: ${message}` },
      { status },
    );
  }
}
