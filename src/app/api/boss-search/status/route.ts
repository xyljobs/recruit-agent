import { NextRequest, NextResponse } from 'next/server';
import {
  assertBossTaskAccess,
  BossCandidateManifest,
  BossRequestIdentity,
  BossTaskFileError,
  getCandidateResumeTextSegments,
  getCandidateScreenshotSegments,
  getBossRequestContext,
  type BossRequestContext,
} from '@/lib/boss-search-task-files';

function getManifestError(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return null;
  }
  const error = (manifest as { error?: unknown }).error;
  return typeof error === 'string' && error.trim() ? error.trim() : null;
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
    { success: false, error: `状态查询失败: ${message}` },
    { status: 500 },
  );
}

/**
 * GET /api/boss-search/status?taskId=...
 * 
 * 从 Supabase 读取任务状态，不依赖本地文件系统。
 */
export async function GET(request: NextRequest) {
  try {
    const context = await getBossRequestContext(request);
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      // 无 taskId 时返回任务列表
      return getTaskList(context);
    }

    const { data: task, error } = await context.supabase
      .from('boss_search_tasks')
      .select('*')
      .eq('id', taskId)
      .eq('organization_id', context.organizationId)
      .single();

    if (error || !task) {
      return NextResponse.json(
        { success: false, error: '任务不存在' },
        { status: 404 }
      );
    }
    assertBossTaskAccess(context, task.user_id);

    // 解析 manifest 摘要
    let candidates: unknown[] = [];
    if (task.manifest) {
      if (Array.isArray(task.manifest)) {
        candidates = task.manifest;
      } else if (task.manifest && typeof task.manifest === 'object' && 'candidates' in task.manifest) {
        candidates = (task.manifest as { candidates: unknown[] }).candidates;
      }
    }

    const validCandidates = candidates.filter((c: unknown) => {
      const candidate = c as { status?: string };
      return candidate.status === 'ok' || candidate.status === 'done';
    });
    const { data: contactRequests } = await context.supabase
      .from('boss_contact_requests')
      .select('id, candidate_index, status, error_message, opened_at, closed_at, created_at')
      .eq('task_id', task.id)
      .eq('organization_id', context.organizationId)
      .order('created_at', { ascending: false });
    const contactByCandidate = new Map<number, {
      id: string;
      status: string;
      error_message: string | null;
      opened_at: string | null;
      closed_at: string | null;
    }>();
    for (const contactRequest of contactRequests || []) {
      if (!contactByCandidate.has(contactRequest.candidate_index)) {
        contactByCandidate.set(contactRequest.candidate_index, contactRequest);
      }
    }
    const emptyCompletedTask = task.status === 'done' && validCandidates.length === 0;
    const status = emptyCompletedTask ? 'error' : task.status;
    const errorMessage = task.error_message || (emptyCompletedTask
      ? getManifestError(task.manifest) || '搜索未返回有效候选人，请调整关键词后重试；若仍为 0 人，请检查 Boss 登录状态或页面风控。'
      : null);

    return NextResponse.json({
      success: true,
      data: {
        taskId: task.id,
        status,
        expectedCount: task.expected_count || 0,
        totalCandidates: task.total_candidates || 0,
        invalidCount: task.invalid_count || 0,
        taskDir: task.task_dir,
        errorMessage,
        reportRequested: task.report_requested,
        reportStatus: task.report_status,
        candidates: validCandidates.map((c: unknown) => {
          const candidate = c as BossCandidateManifest;
          const screenshotSegments = getCandidateScreenshotSegments(candidate);
          const resumeTextSegments = getCandidateResumeTextSegments(candidate);
          const candidateIndex = candidate.global_index || 0;
          const contactRequest = contactByCandidate.get(candidateIndex);
          const summary = Array.isArray(candidate.summary)
            ? candidate.summary.filter((line): line is string => typeof line === 'string').slice(1, 3).join(' · ')
            : typeof candidate.summary === 'string' ? candidate.summary : '';
          return {
            global_index: candidateIndex,
            name: candidate.name || '未知',
            company_title: candidate.company_title || summary,
            has_structured_resume: resumeTextSegments !== null,
            resume_text_chars: candidate.resume_text_chars || 0,
            resume_preview_url: resumeTextSegments
              ? `/api/boss-search/tasks/${encodeURIComponent(task.id)}/resumes/${candidateIndex}`
              : null,
            resume_download_url: resumeTextSegments
              ? `/api/boss-search/tasks/${encodeURIComponent(task.id)}/resumes/${candidateIndex}?download=1`
              : null,
            screenshot_count: screenshotSegments.length,
            screenshots: screenshotSegments.map(segments => (
              `/api/boss-search/tasks/${encodeURIComponent(task.id)}/files/${segments.map(encodeURIComponent).join('/')}`
            )),
            status: candidate.status || 'unknown',
            contact_request_id: contactRequest?.id || null,
            contact_status: contactRequest?.status || null,
            contact_error: contactRequest?.error_message || null,
            contact_opened_at: contactRequest?.opened_at || null,
            contact_closed_at: contactRequest?.closed_at || null,
          };
        }),
        createdAt: task.created_at,
        finishedAt: task.finished_at,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * 返回最近的 Boss 搜索任务列表
 */
async function getTaskList(context: BossRequestContext) {
  try {
    let query = context.supabase
      .from('boss_search_tasks')
      .select('id, status, expected_count, total_candidates, invalid_count, created_at, finished_at, error_message')
      .eq('organization_id', context.organizationId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (context.role !== 'admin') {
      query = query.eq('user_id', context.userId);
    }
    const { data: tasks, error } = await query;

    if (error) {
      return NextResponse.json(
        { success: false, error: `获取任务列表失败: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        tasks: tasks || [],
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
