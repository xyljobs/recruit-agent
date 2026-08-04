import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import {
  BossTaskFileError,
  getBossTaskForFileAccess,
  getContentDisposition,
  getImageContentType,
  resolveBossTaskFile,
} from '@/lib/boss-search-task-files';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ taskId: string; path: string[] }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { taskId, path } = await context.params;
    const task = await getBossTaskForFileAccess(request, taskId);
    const filePath = await resolveBossTaskFile(task.task_dir as string, path);
    const contentType = getImageContentType(filePath);
    if (!contentType) {
      return NextResponse.json(
        { success: false, error: '仅支持查看简历图片' },
        { status: 415 },
      );
    }

    const file = await readFile(filePath);
    const download = new URL(request.url).searchParams.get('download') === '1';
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': getContentDisposition(download ? 'attachment' : 'inline', basename(filePath)),
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
