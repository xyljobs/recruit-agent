import { readFile } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import {
  BossCandidateManifest,
  BossTaskFileError,
  getBossTaskForFileAccess,
  getCandidateScreenshotSegments,
  getContentDisposition,
  getImageContentType,
  getManifestCandidates,
  resolveBossTaskFile,
} from '@/lib/boss-search-task-files';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getSummaryLines(candidate: BossCandidateManifest): string[] {
  if (Array.isArray(candidate.summary)) {
    return candidate.summary.filter((line): line is string => typeof line === 'string' && Boolean(line.trim()));
  }
  return typeof candidate.summary === 'string' && candidate.summary.trim()
    ? [candidate.summary]
    : [];
}

async function readSkillReport(
  taskDir: string,
  resumeUrlTemplate: string,
): Promise<string | null> {
  try {
    const reportPath = await resolveBossTaskFile(taskDir, ['report.html']);
    const source = await readFile(reportPath, 'utf-8');
    const resumeTarget = `const RESUME_URL_TEMPLATE = ${JSON.stringify(resumeUrlTemplate)};`;
    const withResumeTarget = source.replace(
      'const RESUME_URL_TEMPLATE = null;',
      resumeTarget,
    );
    if (withResumeTarget !== source) {
      return withResumeTarget;
    }

    // 兼容升级前生成的旧报告。
    const bridge = `
      let result;
      if (window.pywebview?.api?.open_resume) {
        result = await window.pywebview.api.open_resume(idx);
      } else {
        const target = ${JSON.stringify(resumeUrlTemplate)}.replace('__INDEX__', String(idx));
        const opened = window.open(target, '_blank', 'noopener');
        result = opened ? { status: 'ok', message: '✓ 已打开' } : { status: 'error', message: '✗ 请允许弹出窗口' };
      }`;
    return source.replace(
      'const result = await window.pywebview.api.open_resume(idx);',
      bridge,
    );
  } catch (error) {
    if (error instanceof BossTaskFileError && error.status === 404) return null;
    throw error;
  }
}

async function renderCandidate(
  taskDir: string,
  candidate: BossCandidateManifest,
  fallbackIndex: number,
): Promise<string> {
  const index = candidate.global_index ?? fallbackIndex;
  const summaryLines = getSummaryLines(candidate);
  const imageData = await Promise.all(getCandidateScreenshotSegments(candidate).map(async segments => {
    try {
      const filePath = await resolveBossTaskFile(taskDir, segments);
      const contentType = getImageContentType(filePath);
      if (!contentType) return null;
      const bytes = await readFile(filePath);
      return `data:${contentType};base64,${bytes.toString('base64')}`;
    } catch {
      return null;
    }
  }));
  const images = imageData.filter((image): image is string => Boolean(image));

  return `
    <section class="candidate">
      <div class="candidate-heading">
        <span class="index">${index}</span>
        <div>
          <h2>${escapeHtml(candidate.name || `候选人 ${index}`)}</h2>
          <p>${escapeHtml(candidate.keyword || 'Boss 候选人搜索')}</p>
        </div>
        <span class="count">${images.length} 张简历截图</span>
      </div>
      ${summaryLines.length > 0 ? `<ul class="summary">${summaryLines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : ''}
      <details open>
        <summary>查看完整简历截图</summary>
        <div class="screenshots">
          ${images.map((src, imageIndex) => `<figure><img src="${src}" alt="${escapeHtml(candidate.name || `候选人 ${index}`)}简历第 ${imageIndex + 1} 页"><figcaption>第 ${imageIndex + 1} 页</figcaption></figure>`).join('')}
        </div>
      </details>
    </section>`;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const task = await getBossTaskForFileAccess(request, taskId);
    const download = new URL(request.url).searchParams.get('download') === '1';
    const filename = `Boss候选人报告-${task.id.slice(0, 8)}.html`;
    const resumeUrlTemplate = new URL(
      `/api/boss-search/tasks/${encodeURIComponent(task.id)}/resumes/__INDEX__`,
      request.nextUrl.origin,
    ).toString();
    const skillReport = await readSkillReport(task.task_dir as string, resumeUrlTemplate);
    if (skillReport) {
      return new NextResponse(skillReport, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': getContentDisposition(download ? 'attachment' : 'inline', filename),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    if (task.report_status === 'generating' || task.report_status === 'requested') {
      throw new BossTaskFileError('完整评估报告正在生成，请稍后再试', 409);
    }
    if (task.report_status === 'error') {
      const summary = task.result_summary && typeof task.result_summary === 'object'
        ? task.result_summary as { report_error?: unknown }
        : null;
      const detail = typeof summary?.report_error === 'string'
        ? summary.report_error
        : task.error_message;
      throw new BossTaskFileError(
        detail ? `完整评估报告生成失败：${detail}` : '完整评估报告生成失败，请重新生成',
        409,
      );
    }

    const candidates = getManifestCandidates(task.manifest).filter(candidate => (
      candidate.status === 'ok' || candidate.status === 'done'
    ));
    const renderedCandidates = await Promise.all(
      candidates.map((candidate, index) => renderCandidate(task.task_dir as string, candidate, index + 1)),
    );

    const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Boss 候选人搜索报告</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #111827; background: #f8fafc; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px 20px 64px; }
    main { width: min(1120px, 100%); margin: 0 auto; }
    header, .candidate, .jd { background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; box-shadow: 0 1px 3px rgb(15 23 42 / 0.08); }
    header { padding: 28px; }
    h1 { margin: 0; font-size: 28px; }
    .meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
    .pill { padding: 7px 12px; border-radius: 999px; background: #eff6ff; color: #2563eb; font-size: 14px; }
    .jd { margin-top: 20px; padding: 20px 24px; }
    .jd summary, .candidate summary { cursor: pointer; font-weight: 650; }
    .jd p { white-space: pre-wrap; color: #475569; line-height: 1.75; }
    .candidate { margin-top: 20px; padding: 24px; break-inside: avoid; }
    .candidate-heading { display: flex; align-items: center; gap: 14px; }
    .candidate-heading h2 { margin: 0; font-size: 20px; }
    .candidate-heading p { margin: 5px 0 0; color: #64748b; font-size: 14px; }
    .index { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 999px; background: #f1f5f9; font-weight: 700; }
    .count { margin-left: auto; color: #2563eb; background: #eff6ff; border-radius: 999px; padding: 6px 10px; font-size: 13px; }
    .summary { color: #475569; line-height: 1.7; }
    .candidate details { margin-top: 18px; }
    .screenshots { display: grid; gap: 16px; margin-top: 16px; }
    figure { margin: 0; }
    img { display: block; width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 10px; }
    figcaption { margin-top: 6px; text-align: center; color: #94a3b8; font-size: 12px; }
    footer { margin-top: 24px; text-align: center; color: #94a3b8; font-size: 12px; }
    @media (max-width: 640px) { body { padding: 16px 12px 40px; } header, .candidate { padding: 18px; } .candidate-heading { align-items: flex-start; } .count { white-space: nowrap; } }
    @media print { body { background: #fff; padding: 0; } header, .candidate, .jd { box-shadow: none; } details { display: block; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Boss 候选人搜索报告</h1>
      <div class="meta">
        <span class="pill">任务 ${escapeHtml(task.id.slice(0, 8))}</span>
        <span class="pill">目标 ${task.expected_count ?? 0} 人</span>
        <span class="pill">有效候选人 ${task.total_candidates ?? candidates.length} 人</span>
        <span class="pill">失败 ${task.invalid_count ?? 0} 人</span>
      </div>
    </header>
    <details class="jd">
      <summary>职位描述（JD）</summary>
      <p>${escapeHtml(task.jd_content || '未提供')}</p>
    </details>
    ${renderedCandidates.join('') || '<section class="candidate"><p>当前任务没有可展示的候选人。</p></section>'}
    <footer>生成时间：${escapeHtml(new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))}</footer>
  </main>
</body>
</html>`;

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': getContentDisposition(download ? 'attachment' : 'inline', filename),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const status = error instanceof BossTaskFileError ? error.status : 500;
    const message = error instanceof Error ? error.message : '生成报告失败';
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
