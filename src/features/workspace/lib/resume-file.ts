'use client';

// 简历文件文本提取：全部在浏览器端完成，文件内容不离开用户浏览器，
// 只有提取出的文本会发给服务端做字段提取与入库。
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import { authFetch } from '@/lib/auth-client';

// pdfjs worker 使用本地打包产物（Next.js 会把 pdf.worker.min.mjs 作为静态资源输出）
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_IMPORT_FILES = 50; // 导入列表总量上限（多批追加共享同一上限）

const SUPPORTED_RESUME_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt', '.md'];

/** 合并导入文件的结果：files 为合并后的完整列表，其余为本次被忽略的明细计数 */
export interface ResumeImportMergeResult {
  files: File[];
  /** 类型不支持被忽略的数量 */
  unsupported: number;
  /** 超过 20MB 被忽略的数量 */
  oversize: number;
  /** 与列表中已有文件重复被忽略的数量（同名 + 同大小 + 同修改时间视为同一份） */
  duplicates: number;
  /** 超出总量上限被忽略的数量 */
  overflow: number;
}

/**
 * 追加合并简历导入文件（再次上传不再覆盖已有列表）：
 * 过滤不支持类型与超大文件，按 文件名+大小+修改时间 去重（重复上传视为误操作直接忽略），
 * 合并后总量封顶 50 份。所有导入入口（候选人库拖拽区、职位页导入弹窗）共用。
 */
export function mergeResumeImportFiles(
  previous: File[],
  incoming: File[],
): ResumeImportMergeResult {
  const keyOf = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;
  const seen = new Set(previous.map(keyOf));
  const fresh: File[] = [];
  let unsupported = 0;
  let oversize = 0;
  let duplicates = 0;
  for (const file of incoming) {
    if (
      !SUPPORTED_RESUME_EXTENSIONS.some(ext =>
        file.name.toLowerCase().endsWith(ext),
      )
    ) {
      unsupported += 1;
      continue;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      oversize += 1;
      continue;
    }
    const key = keyOf(file);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    fresh.push(file);
  }
  const room = Math.max(0, MAX_IMPORT_FILES - previous.length);
  const accepted = fresh.slice(0, room);
  return {
    files: [...previous, ...accepted],
    unsupported,
    oversize,
    duplicates,
    overflow: fresh.length - accepted.length,
  };
}

async function extractPdfText(arrayBuffer: ArrayBuffer): Promise<string> {
  const document = await pdfjsLib
    .getDocument({ data: arrayBuffer })
    .promise;
  let text = '';
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    text += `${pageText}\n`;
  }
  return text;
}

async function extractDocxText(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

/** 简历原样预览内容：PDF 用浏览器原生渲染，Word 转 HTML，文本直接展示 */
export type ResumePreview =
  | { kind: 'pdf'; url: string }
  | { kind: 'html'; html: string }
  | { kind: 'text'; text: string };

/**
 * 生成简历原文件预览内容（不做字段解析）：
 * PDF 直接返回 blob URL 由浏览器原生 PDF 查看器原样渲染；
 * Word 用 mammoth 转 HTML 近似还原排版；纯文本展示原文。
 */
export async function previewResumeFile(file: File): Promise<ResumePreview> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('文件超过 20MB，请压缩后重试');
  }
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) {
    return { kind: 'pdf', url: URL.createObjectURL(file) };
  }
  if (name.endsWith('.docx')) {
    const result = await mammoth.convertToHtml({
      arrayBuffer: await file.arrayBuffer(),
    });
    return { kind: 'html', html: result.value };
  }
  if (name.endsWith('.doc')) {
    throw new Error('暂不支持 .doc 旧格式，请在 Word 中另存为 .docx 后重试');
  }
  if (name.endsWith('.txt') || name.endsWith('.md')) {
    return { kind: 'text', text: await file.text() };
  }
  throw new Error('仅支持 PDF / Word(.docx) / 纯文本(.txt) 简历文件');
}

/**
 * 把简历原文件上传到候选人记录（私有存储），供候选人详情展示原始简历。
 * 入库成功后即调用——原件属于「解析入库」动作的一部分，必须尽最大努力落盘：
 * 网络瞬断 / 服务重启窗口 / 5xx 自动重试（2s/4s/8s 共 4 次尝试），
 * 4xx 业务错误（类型/大小不符）重试无意义，直接抛出由调用方提示。
 */
const UPLOAD_RETRY_DELAYS_MS = [2000, 4000, 8000];

class ResumeUploadBusinessError extends Error {}

export async function uploadCandidateResumeFile(
  candidateId: string,
  file: File,
): Promise<void> {
  const formData = new FormData();
  formData.set('file', file);
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= UPLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, UPLOAD_RETRY_DELAYS_MS[attempt - 1]));
    }
    try {
      const response = await authFetch(
        `/api/candidates/${candidateId}/resume-file`,
        {
          method: 'POST',
          body: formData,
        },
      );
      const result = (await response.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;
      if (response.ok && result?.success) {
        return;
      }
      if (response.status < 500) {
        // 业务错误（文件类型/大小/权限）：重试不会改变结果
        throw new ResumeUploadBusinessError(
          result?.error || '原始简历文件保存失败',
        );
      }
      lastError = new Error(result?.error || '服务器暂时不可用');
    } catch (error) {
      if (error instanceof ResumeUploadBusinessError) {
        throw error;
      }
      // 网络层错误（服务重启窗口 / 连接中断）：进入下一轮重试
      lastError = error;
    }
  }
  throw new Error(
    `原始简历文件暂未保存（已自动重试）：${
      lastError instanceof Error ? lastError.message : '网络异常'
    }`,
  );
}

/** 从简历文件提取纯文本；不支持的类型抛出中文错误提示 */
export async function extractResumeTextFromFile(file: File): Promise<string> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('文件超过 20MB，请压缩后重试');
  }
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) {
    return extractPdfText(await file.arrayBuffer());
  }
  if (name.endsWith('.docx')) {
    return extractDocxText(await file.arrayBuffer());
  }
  if (name.endsWith('.doc')) {
    throw new Error('暂不支持 .doc 旧格式，请在 Word 中另存为 .docx 后重试');
  }
  if (name.endsWith('.txt') || name.endsWith('.md')) {
    return file.text();
  }
  throw new Error('仅支持 PDF / Word(.docx) / 纯文本(.txt) 简历文件');
}

/**
 * 从拖拽事件收集文件：递归展开文件夹（含子目录）中的全部文件。
 * 浏览器不支持 entry 遍历（无法识别目录）时回退到 dataTransfer.files。
 */
export async function collectFilesFromDataTransfer(
  dataTransfer: DataTransfer,
): Promise<File[]> {
  const entries = Array.from(dataTransfer.items)
    .map(item => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);
  if (entries.length === 0) {
    return Array.from(dataTransfer.files);
  }

  const files: File[] = [];
  async function walk(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      files.push(file);
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        // readEntries 单次最多返回 100 项，需循环读取直至为空
        batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
          reader.readEntries(resolve, reject);
        });
        for (const child of batch) {
          await walk(child);
        }
      } while (batch.length > 0);
    }
  }
  await Promise.all(entries.map(entry => walk(entry)));
  return files;
}
