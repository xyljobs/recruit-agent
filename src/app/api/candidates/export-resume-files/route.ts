import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { getTenantRequestContext } from '@/lib/auth-server';
import { apiErrorResponse } from '@/lib/api-response';
import { getContentDisposition } from '@/lib/boss-search-task-files';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';

export const runtime = 'nodejs';

const RESUME_FILE_BUCKET = 'candidate-resumes';

interface ResumeFileRow {
  id: string;
  resume_file_path: string;
  resume_file_name: string | null;
}

/** 去除 zip 内文件名中的非法字符，避免打包失败 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从文件路径或名称提取扩展名（含点），无扩展名时返回空串 */
function extractExtension(pathOrName: string): string {
  const match = pathOrName.match(/\.[a-z0-9]+$/i);
  return match ? match[0].toLowerCase() : '';
}

/** 生成 zip 内条目名：优先原始文件名，重名时追加序号，保证唯一 */
function buildEntryName(
  originalName: string | null,
  storagePath: string,
  index: number,
  usedNames: Set<string>,
): string {
  const fallbackExt = extractExtension(storagePath);
  let base = sanitizeFileName(originalName || '');
  if (!base) {
    base = `简历_${index + 1}`;
  }
  if (!extractExtension(base) && fallbackExt) {
    base += fallbackExt;
  }
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }
  const ext = extractExtension(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  let seq = 2;
  let candidate = `${stem}_${seq}${ext}`;
  while (usedNames.has(candidate)) {
    seq += 1;
    candidate = `${stem}_${seq}${ext}`;
  }
  usedNames.add(candidate);
  return candidate;
}

/**
 * 候选人原始简历文件批量导出 API
 * POST /api/candidates/export-resume-files
 * 将当前租户已上传的原始简历文件（PDF/Word/文本）打包为 ZIP 下载；
 * 请求体可传 candidateIds 限定范围，缺省时导出全部有原文件的候选人。
 * 仅包含已登记原文件的候选人，纯文字录入者不参与打包。
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);

    const body = await request.json().catch(() => ({}));
    const candidateIds: string[] | undefined =
      Array.isArray(body?.candidateIds) && body.candidateIds.length > 0
        ? body.candidateIds
        : undefined;

    let query = supabase
      .from('candidates')
      .select('id, resume_file_path, resume_file_name')
      .eq('organization_id', user.organizationId)
      .not('resume_file_path', 'is', null);
    if (candidateIds) {
      query = query.in('id', candidateIds);
    }

    const { data: candidates, error } = await query;
    if (error) {
      throw new Error(`查询候选人失败: ${error.message}`);
    }
    if (!candidates || candidates.length === 0) {
      return NextResponse.json(
        { success: false, error: '暂无可导出的简历文件' },
        { status: 404 },
      );
    }

    const serviceSupabase = getSupabaseServiceClient();
    const zip = new JSZip();
    const usedNames = new Set<string>();
    let exported = 0;

    for (let index = 0; index < candidates.length; index += 1) {
      const row = candidates[index] as ResumeFileRow;
      const { data: fileData, error: downloadError } = await serviceSupabase.storage
        .from(RESUME_FILE_BUCKET)
        .download(row.resume_file_path);
      if (downloadError || !fileData) {
        continue;
      }
      const buffer = Buffer.from(await fileData.arrayBuffer());
      const entryName = buildEntryName(
        row.resume_file_name,
        row.resume_file_path,
        index,
        usedNames,
      );
      zip.file(entryName, buffer);
      exported += 1;
    }

    if (exported === 0) {
      return NextResponse.json(
        { success: false, error: '暂无可导出的简历文件' },
        { status: 404 },
      );
    }

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });
    const filename = `候选人简历文件_${new Date().toISOString().slice(0, 10)}.zip`;
    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': getContentDisposition('attachment', filename),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return apiErrorResponse(error, '导出简历文件失败');
  }
}
