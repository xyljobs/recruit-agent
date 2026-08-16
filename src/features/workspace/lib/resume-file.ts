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
 * 入库成功后再调用；失败抛错由调用方决定提示方式（不影响入库结果）。
 */
export async function uploadCandidateResumeFile(
  candidateId: string,
  file: File,
): Promise<void> {
  const formData = new FormData();
  formData.set('file', file);
  const response = await authFetch(
    `/api/candidates/${candidateId}/resume-file`,
    {
      method: 'POST',
      body: formData,
    },
  );
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.error || '原始简历文件保存失败');
  }
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
