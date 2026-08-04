import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getTenantRequestContext } from '@/lib/auth-server';
import {
  ensureResumeBatchBucket,
  normalizePdfName,
  RESUME_BATCH_BUCKET,
  RESUME_BATCH_MAX_FILES,
  RESUME_BATCH_MAX_FILE_SIZE,
  resumeSheetLabel,
  type ResumeBatchFileRecord,
  validateResumeSheetTarget,
} from '@/lib/resume-batch';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';

export const runtime = 'nodejs';
export const maxDuration = 300;

function parseCheckbox(value: FormDataEntryValue | null): boolean {
  return value === 'true' || value === '1' || value === 'on';
}

export async function POST(request: NextRequest) {
  const uploadedPaths: string[] = [];
  let taskId: string | null = null;
  let tenantSupabase: SupabaseClient | null = null;
  let organizationId: string | null = null;

  try {
    const { supabase, user } = await getTenantRequestContext(request);
    tenantSupabase = supabase;
    organizationId = user.organizationId;
    const formData = await request.formData();
    let sheetUrl: string;
    try {
      sheetUrl = validateResumeSheetTarget(String(formData.get('sheetUrl') || ''));
    } catch (error) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : '表格链接不正确' },
        { status: 400 },
      );
    }
    const worksheetId = String(formData.get('worksheetId') || '').trim() || null;
    if (worksheetId && worksheetId.length > 200) {
      return NextResponse.json(
        { success: false, error: '工作表 ID 不能超过 200 个字符' },
        { status: 400 },
      );
    }
    const overwrite = parseCheckbox(formData.get('overwrite'));
    const dryRun = parseCheckbox(formData.get('dryRun'));
    const files = formData.getAll('files').filter((value): value is File => value instanceof File);

    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: '请选择至少一份 PDF 简历' },
        { status: 400 },
      );
    }
    if (files.length > RESUME_BATCH_MAX_FILES) {
      return NextResponse.json(
        { success: false, error: `单次最多上传 ${RESUME_BATCH_MAX_FILES} 份简历` },
        { status: 400 },
      );
    }

    const normalizedNames = files.map(file => normalizePdfName(file.name));
    const invalidFile = files.find((file, index) => (
      !normalizedNames[index].toLowerCase().endsWith('.pdf')
      || file.size <= 0
      || file.size > RESUME_BATCH_MAX_FILE_SIZE
    ));
    if (invalidFile) {
      return NextResponse.json(
        {
          success: false,
          error: `${normalizePdfName(invalidFile.name)} 不是有效 PDF，或文件超过 30MB`,
        },
        { status: 400 },
      );
    }

    const nameKeys = normalizedNames.map(name => name.toLocaleLowerCase('zh-CN'));
    if (new Set(nameKeys).size !== nameKeys.length) {
      return NextResponse.json(
        { success: false, error: '存在重名 PDF，请调整文件名后重试' },
        { status: 400 },
      );
    }

    const serviceSupabase = getSupabaseServiceClient();
    const { count: credentialCount, error: credentialError } = await serviceSupabase
      .from('resume_batch_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', user.organizationId);
    if (credentialError) {
      throw new Error(`检查 MCP 凭证失败: ${credentialError.message}`);
    }
    if (!credentialCount) {
      return NextResponse.json(
        { success: false, error: '未配置钉钉组织凭证，请联系管理员添加' },
        { status: 400 },
      );
    }

    taskId = randomUUID();
    const { error: taskError } = await supabase
      .from('resume_batch_tasks')
      .insert({
        id: taskId,
        organization_id: user.organizationId,
        user_id: user.userId,
        sheet_preset_id: null,
        credential_id: null,
        sheet_name: resumeSheetLabel(sheetUrl),
        sheet_url: sheetUrl,
        worksheet_id: worksheetId,
        files: [],
        overwrite,
        dry_run: dryRun,
        status: 'uploading',
        logs: [`准备上传 ${files.length} 份 PDF 简历…`],
      });
    if (taskError) {
      throw new Error(`创建任务失败: ${taskError.message}`);
    }

    await ensureResumeBatchBucket(serviceSupabase);
    const fileRecords: ResumeBatchFileRecord[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const storagePath = `${user.organizationId}/${taskId}/input/${String(index + 1).padStart(3, '0')}-${randomUUID()}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from(RESUME_BATCH_BUCKET)
        .upload(storagePath, Buffer.from(await file.arrayBuffer()), {
          contentType: 'application/pdf',
          upsert: false,
        });
      if (uploadError) {
        throw new Error(`上传 ${normalizedNames[index]} 失败: ${uploadError.message}`);
      }
      uploadedPaths.push(storagePath);
      fileRecords.push({
        name: normalizedNames[index],
        storage_path: storagePath,
        size: file.size,
      });
    }

    const { error: readyError } = await supabase
      .from('resume_batch_tasks')
      .update({
        files: fileRecords,
        status: 'pending',
        logs: [
          `已上传 ${files.length} 份 PDF`,
          '任务已入队，等待本地简历 Worker 处理',
        ],
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId)
      .eq('organization_id', user.organizationId)
      .eq('status', 'uploading');
    if (readyError) {
      throw new Error(`任务入队失败: ${readyError.message}`);
    }

    return NextResponse.json({
      success: true,
      data: {
        taskId,
        status: 'pending',
        fileCount: files.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    try {
      if (tenantSupabase && uploadedPaths.length > 0) {
        await tenantSupabase.storage.from(RESUME_BATCH_BUCKET).remove(uploadedPaths);
      }
      if (tenantSupabase && taskId && organizationId) {
        await tenantSupabase
          .from('resume_batch_tasks')
          .update({
            status: 'error',
            error_message: message,
            logs: [`上传失败: ${message}`],
            finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', taskId)
          .eq('organization_id', organizationId);
      }
    } catch {
      // 原始错误优先返回；残留对象可由管理员按 taskId 清理。
    }
    const status = message === '未登录' || message === '登录信息无效' ? 401 : 500;
    return NextResponse.json(
      { success: false, error: `提交简历批处理任务失败: ${message}` },
      { status },
    );
  }
}
