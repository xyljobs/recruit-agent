import { NextRequest, NextResponse } from 'next/server';
import {
  BossTaskFileError,
  getBossRequestContext,
  getBossTaskForFileAccess,
  getManifestCandidate,
} from '@/lib/boss-search-task-files';

interface ContactRequestBody {
  taskId?: string;
  candidateIndex?: number;
}

function errorResponse(error: unknown) {
  if (error instanceof BossTaskFileError) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : '未知错误';
  return NextResponse.json(
    { success: false, error: `联系请求失败: ${message}` },
    { status: 500 },
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ContactRequestBody;
    const taskId = body.taskId?.trim();
    const candidateIndex = body.candidateIndex;
    if (!taskId || !Number.isInteger(candidateIndex) || (candidateIndex as number) < 1) {
      return NextResponse.json(
        { success: false, error: '任务ID或候选人编号无效' },
        { status: 400 },
      );
    }

    const context = await getBossRequestContext(request);
    const task = await getBossTaskForFileAccess(request, taskId, context);
    const candidate = getManifestCandidate(task.manifest, candidateIndex as number);
    if (!candidate || (candidate.status !== 'ok' && candidate.status !== 'done')) {
      return NextResponse.json(
        { success: false, error: '候选人不存在或简历采集未完成' },
        { status: 404 },
      );
    }
    if (
      typeof candidate.keyword_dir !== 'string'
      || typeof candidate.dir !== 'string'
      || !Number.isInteger(candidate.index)
    ) {
      return NextResponse.json(
        { success: false, error: '候选人缺少Boss原页面定位信息' },
        { status: 409 },
      );
    }

    const { data: existing } = await context.supabase
      .from('boss_contact_requests')
      .select('id, status, error_message, opened_at')
      .eq('task_id', taskId)
      .eq('organization_id', context.organizationId)
      .eq('candidate_index', candidateIndex)
      .in('status', ['requested', 'opening', 'opened'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        success: true,
        data: {
          requestId: existing.id,
          status: existing.status,
          errorMessage: existing.error_message,
          openedAt: existing.opened_at,
        },
      });
    }

    const now = new Date().toISOString();
    const { data: created, error } = await context.supabase
      .from('boss_contact_requests')
      .insert({
        organization_id: context.organizationId,
        task_id: taskId,
        candidate_index: candidateIndex,
        requested_by: context.userId,
        status: 'requested',
        created_at: now,
        updated_at: now,
      })
      .select('id, status, created_at')
      .single();

    if (error || !created) {
      throw new Error(error?.message || '无法创建联系请求');
    }

    return NextResponse.json({
      success: true,
      data: {
        requestId: created.id,
        status: created.status,
        createdAt: created.created_at,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const requestId = new URL(request.url).searchParams.get('requestId')?.trim();
    if (!requestId) {
      return NextResponse.json(
        { success: false, error: '请提供联系请求ID' },
        { status: 400 },
      );
    }

    const context = await getBossRequestContext(request);
    const { data: contactRequest, error } = await context.supabase
      .from('boss_contact_requests')
      .select('id, task_id, candidate_index, status, error_message, opened_at, closed_at, created_at, updated_at')
      .eq('id', requestId)
      .eq('organization_id', context.organizationId)
      .single();
    if (error || !contactRequest) {
      return NextResponse.json(
        { success: false, error: '联系请求不存在' },
        { status: 404 },
      );
    }

    await getBossTaskForFileAccess(request, contactRequest.task_id, context);
    return NextResponse.json({
      success: true,
      data: {
        requestId: contactRequest.id,
        candidateIndex: contactRequest.candidate_index,
        status: contactRequest.status,
        errorMessage: contactRequest.error_message,
        openedAt: contactRequest.opened_at,
        closedAt: contactRequest.closed_at,
        createdAt: contactRequest.created_at,
        updatedAt: contactRequest.updated_at,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
