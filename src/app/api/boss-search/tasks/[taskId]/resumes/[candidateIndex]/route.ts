import { readFile } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import {
  BossTaskFileError,
  getBossTaskForFileAccess,
  getCandidateResumeTextSegments,
  getContentDisposition,
  getManifestCandidate,
  resolveBossTaskFile,
} from '@/lib/boss-search-task-files';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ taskId: string; candidateIndex: string }>;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const SECTION_HEADING = /^(个人优势|求职期望|期望职位|工作经历|项目经历|教育经历|培训经历|专业技能|技能特长|资格证书|自我评价|社交主页|附加信息)[：:]?$/;

function renderResumeHtml(name: string, text: string): string {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const content = lines.map(line => (
    SECTION_HEADING.test(line)
      ? `<h2>${escapeHtml(line.replace(/[：:]$/, ''))}</h2>`
      : `<p>${escapeHtml(line)}</p>`
  )).join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(name)} · 结构化简历</title>
  <style>
    :root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #172033; background: #f4f6fa; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px 18px 64px; }
    main { width: min(860px, 100%); margin: 0 auto; background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 34px 42px; box-shadow: 0 2px 8px rgb(15 23 42 / .06); }
    header { padding-bottom: 20px; border-bottom: 2px solid #3182ce; }
    h1 { margin: 0; font-size: 28px; }
    header p { color: #64748b; margin: 8px 0 0; }
    section { padding-top: 10px; }
    h2 { margin: 28px 0 10px; padding-left: 10px; border-left: 4px solid #3182ce; font-size: 17px; color: #1e3a5f; }
    section p { margin: 7px 0; line-height: 1.75; white-space: pre-wrap; }
    @media (max-width: 640px) { body { padding: 0; } main { border: 0; border-radius: 0; padding: 24px 20px 48px; } }
    @media print { :root { background: white; } body { padding: 0; } main { border: 0; box-shadow: none; } }
  </style>
</head>
<body>
  <main>
    <header><h1>${escapeHtml(name)}</h1><p>可搜索、复制和打印的在线简历</p></header>
    <section>${content || '<p>未提取到可展示内容。</p>'}</section>
  </main>
</body>
</html>`;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { taskId, candidateIndex: rawIndex } = await context.params;
    const candidateIndex = Number(rawIndex);
    const task = await getBossTaskForFileAccess(request, taskId);
    const candidate = getManifestCandidate(task.manifest, candidateIndex);
    if (!candidate) {
      throw new BossTaskFileError('候选人不存在', 404);
    }
    const segments = getCandidateResumeTextSegments(candidate);
    if (!segments) {
      throw new BossTaskFileError('该候选人尚未生成结构化简历', 404);
    }
    const filePath = await resolveBossTaskFile(task.task_dir as string, segments);
    const text = await readFile(filePath, 'utf-8');
    const name = candidate.name || `候选人 ${candidateIndex}`;
    const format = new URL(request.url).searchParams.get('format');
    if (format === 'json') {
      return NextResponse.json({
        success: true,
        data: { name, text, characters: text.length },
      }, {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    const download = new URL(request.url).searchParams.get('download') === '1';
    const filename = `${name}-结构化简历.html`;
    return new NextResponse(renderResumeHtml(name, text), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': getContentDisposition(download ? 'attachment' : 'inline', filename),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const status = error instanceof BossTaskFileError ? error.status : 500;
    const message = error instanceof Error ? error.message : '读取简历失败';
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
