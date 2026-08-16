import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  getTenantRequestContext,
  type TenantRequestContext,
} from '@/lib/auth-server';
import { apiErrorResponse } from '@/lib/api-response';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';

export const runtime = 'nodejs';

const RESUME_FILE_BUCKET = 'candidate-resumes';
const RESUME_FILE_MAX_SIZE = 30 * 1024 * 1024; // 30MB
const SIGNED_URL_EXPIRES_IN_SECONDS = 3600;

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];

function contentTypeFor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return 'text/plain';
}

/** 确保私有 bucket 存在（缺失时创建；storage 服务缺失时抛出错误） */
async function ensureCandidateResumesBucket(
  serviceSupabase: ReturnType<typeof getSupabaseServiceClient>,
): Promise<void> {
  const { data: buckets, error: listError } = await serviceSupabase.storage
    .listBuckets();
  if (listError) {
    throw new Error(`读取存储桶失败: ${listError.message}`);
  }
  if (buckets?.some(bucket => bucket.id === RESUME_FILE_BUCKET)) {
    return;
  }
  const { error: createError } = await serviceSupabase.storage.createBucket(
    RESUME_FILE_BUCKET,
    { public: false, fileSizeLimit: RESUME_FILE_MAX_SIZE },
  );
  if (createError) {
    throw new Error(`创建存储桶失败: ${createError.message}`);
  }
}

/** 查询候选人并校验属于当前租户，返回其已有简历文件路径 */
async function findTenantCandidate(
  supabase: TenantRequestContext['supabase'],
  candidateId: string,
  organizationId: string,
): Promise<{ id: string; resume_file_path: string | null } | null> {
  const { data, error } = await supabase
    .from('candidates')
    .select('id, resume_file_path')
    .eq('id', candidateId)
    .eq('organization_id', organizationId)
    .single();
  if (error?.code === 'PGRST116') {
    return null;
  }
  if (error) {
    throw new Error(`查询候选人失败: ${error.message}`);
  }
  return data as { id: string; resume_file_path: string | null };
}

/**
 * 候选人原始简历文件 API
 * POST /api/candidates/[id]/resume-file
 * 上传简历原文件（PDF/Word/文本）到私有存储，并登记到候选人记录；
 * 已有旧文件会被替换删除。文件内容加密与否见部署说明，访问仅经签名 URL。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: candidateId } = await params;
    const { supabase, user } = await getTenantRequestContext(request);

    const candidate = await findTenantCandidate(
      supabase,
      candidateId,
      user.organizationId,
    );
    if (!candidate) {
      return NextResponse.json(
        { success: false, error: '候选人不存在或无权访问' },
        { status: 404 },
      );
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: '请通过 file 字段上传简历文件' },
        { status: 400 },
      );
    }
    const lowerName = file.name.toLowerCase();
    if (!ALLOWED_EXTENSIONS.some(ext => lowerName.endsWith(ext))) {
      return NextResponse.json(
        { success: false, error: '仅支持 PDF / Word(.docx) / 纯文本(.txt/.md) 简历文件' },
        { status: 400 },
      );
    }
    if (file.size <= 0 || file.size > RESUME_FILE_MAX_SIZE) {
      return NextResponse.json(
        { success: false, error: `文件大小须在 30MB 以内（当前 ${Math.round(file.size / 1024 / 1024)}MB）` },
        { status: 400 },
      );
    }

    const serviceSupabase = getSupabaseServiceClient();
    await ensureCandidateResumesBucket(serviceSupabase);

    const extension = lowerName.match(/\.[a-z0-9]+$/)?.[0] ?? '';
    const storagePath = `${user.organizationId}/${candidateId}/${randomUUID()}${extension}`;
    const { error: uploadError } = await serviceSupabase.storage
      .from(RESUME_FILE_BUCKET)
      .upload(storagePath, Buffer.from(await file.arrayBuffer()), {
        contentType: contentTypeFor(file.name),
        upsert: false,
      });
    if (uploadError) {
      throw new Error(`上传简历文件失败: ${uploadError.message}`);
    }

    const { error: updateError } = await serviceSupabase
      .from('candidates')
      .update({
        resume_file_path: storagePath,
        resume_file_name: file.name,
        resume_file_size: file.size,
      })
      .eq('id', candidateId)
      .eq('organization_id', user.organizationId);
    if (updateError) {
      // 数据库登记失败时回滚已上传对象，避免孤儿文件
      await serviceSupabase.storage
        .from(RESUME_FILE_BUCKET)
        .remove([storagePath]);
      throw new Error(`登记简历文件失败: ${updateError.message}`);
    }

    // 替换成功后清理旧文件（尽力而为，失败不影响本次上传）
    if (candidate.resume_file_path) {
      try {
        await serviceSupabase.storage
          .from(RESUME_FILE_BUCKET)
          .remove([candidate.resume_file_path]);
      } catch {
        // 旧对象残留可接受；原始错误优先。
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        path: storagePath,
        name: file.name,
        size: file.size,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, '上传简历文件失败');
  }
}

/**
 * GET /api/candidates/[id]/resume-file
 * 返回原始简历文件的签名访问 URL；候选人无原文件时 data 为 null。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: candidateId } = await params;
    const { supabase, user } = await getTenantRequestContext(request);

    const candidate = await findTenantCandidate(
      supabase,
      candidateId,
      user.organizationId,
    );
    if (!candidate) {
      return NextResponse.json(
        { success: false, error: '候选人不存在或无权访问' },
        { status: 404 },
      );
    }

    const { data: detail, error: detailError } = await supabase
      .from('candidates')
      .select('resume_file_path, resume_file_name, resume_file_size')
      .eq('id', candidateId)
      .eq('organization_id', user.organizationId)
      .single();
    if (detailError) {
      throw new Error(`读取候选人失败: ${detailError.message}`);
    }
    if (!detail?.resume_file_path) {
      return NextResponse.json({ success: true, data: null });
    }

    const serviceSupabase = getSupabaseServiceClient();
    const { data: signed, error: signError } = await serviceSupabase.storage
      .from(RESUME_FILE_BUCKET)
      .createSignedUrl(
        detail.resume_file_path as string,
        SIGNED_URL_EXPIRES_IN_SECONDS,
      );
    if (signError) {
      // 文件可能已被删除：降级为无文件，前端回退展示简历摘要
      return NextResponse.json({ success: true, data: null });
    }

    return NextResponse.json({
      success: true,
      data: {
        url: signed.signedUrl,
        name: detail.resume_file_name,
        size: detail.resume_file_size,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, '读取简历文件失败');
  }
}
