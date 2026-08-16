'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Upload,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { authFetch } from '@/lib/auth-client';
import {
  extractResumeTextFromFile,
  previewResumeFile,
  uploadCandidateResumeFile,
  type ResumePreview,
} from '../lib/resume-file';
import { QuickImportDialog } from './candidate-dialogs';

interface ImportItem {
  key: string;
  file: File;
  status: 'pending' | 'importing' | 'done' | 'failed';
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function stringField(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  return typeof value === 'string' ? value : '';
}

function stringArrayField(
  fields: Record<string, unknown>,
  key: string,
): string[] {
  const value = fields[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * 简历导入预览：上传后仅展示文件列表与原文预览，不做任何自动解析。
 * 用户逐份点击「解析入库」（确认姓名与职位），或多个文件时一键「全部解析入库」。
 */
export function ImportPreviewDialog({
  open,
  onOpenChange,
  files,
  lockedJobId,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: File[];
  lockedJobId?: string | null;
  onImported: () => Promise<void>;
}) {
  const [items, setItems] = useState<ImportItem[]>([]);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState('');
  const [preview, setPreview] = useState<ResumePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [importingItem, setImportingItem] = useState<ImportItem | null>(null);
  const [batchImporting, setBatchImporting] = useState(false);
  const previewTokenRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);

  // 释放当前 PDF blob URL；卸载时兜底释放
  const releasePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);
  useEffect(() => () => releasePreviewUrl(), [releasePreviewUrl]);

  // 打开时按当前传入的文件重建列表（仅登记，不解析）
  useEffect(() => {
    if (open) {
      setItems(
        files.map((file, index) => ({
          key: `${index}-${file.name}-${file.size}`,
          file,
          status: 'pending',
        })),
      );
      setPreviewKey(null);
      setPreviewName('');
      setPreview(null);
      setPreviewError('');
      setImportingItem(null);
    } else {
      setItems([]);
    }
  }, [open, files]);

  function updateItem(key: string, patch: Partial<ImportItem>) {
    setItems(prev =>
      prev.map(item => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  async function handlePreview(item: ImportItem) {
    previewTokenRef.current += 1;
    const token = previewTokenRef.current;
    setPreviewKey(item.key);
    setPreviewName(item.file.name);
    setPreviewLoading(true);
    setPreviewError('');
    setPreview(null);
    try {
      const result = await previewResumeFile(item.file);
      if (token !== previewTokenRef.current) return;
      releasePreviewUrl();
      if (result.kind === 'pdf') {
        previewUrlRef.current = result.url;
      }
      setPreview(result);
    } catch (error) {
      if (token !== previewTokenRef.current) return;
      setPreviewError(error instanceof Error ? error.message : '文件预览失败');
    } finally {
      if (token === previewTokenRef.current) setPreviewLoading(false);
    }
  }

  async function handleSingleImported() {
    if (importingItem) {
      updateItem(importingItem.key, { status: 'done', error: undefined });
    }
    setImportingItem(null);
    await onImported();
  }

  /** 逐份提取文本 + 字段提取 + 自动入库；绑定当前职位或最近使用的职位 */
  async function handleBatchImport() {
    const jobId =
      lockedJobId ?? sessionStorage.getItem('last_job_id') ?? '';
    if (!jobId) {
      toast.error('未找到可绑定的职位：请先打开某个职位，或逐份「解析入库」时手动选择');
      return;
    }
    const pendingItems = items.filter(item => item.status === 'pending');
    setBatchImporting(true);
    let done = 0;
    let failed = 0;
    let fileUploadFailed = 0;
    for (const item of pendingItems) {
      updateItem(item.key, { status: 'importing', error: undefined });
      try {
        const text = await extractResumeTextFromFile(item.file);
        if (text.trim().length < 10) {
          throw new Error('未能提取到有效文本（可能是扫描件图片型 PDF）');
        }
        const extractResponse = await authFetch('/api/candidates/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        const extractResult = await extractResponse.json();
        if (!extractResult.success) {
          throw new Error(extractResult.error || '字段提取失败');
        }
        const fields = (extractResult.data?.extracted ?? {}) as Record<
          string,
          unknown
        >;
        const name =
          typeof fields.name === 'string' ? fields.name.trim() : '';
        if (!name) {
          throw new Error('未识别出候选人姓名');
        }
        const importResponse = await authFetch('/api/candidates/quick-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email: stringField(fields, 'email') || null,
            phone: stringField(fields, 'phone') || null,
            source_job_id: jobId,
            skills: stringArrayField(fields, 'skills'),
            experience_years:
              typeof fields.experience_years === 'number'
                ? (fields.experience_years as number)
                : null,
            education: stringField(fields, 'education') || null,
            current_company: stringField(fields, 'current_company') || null,
            current_position: stringField(fields, 'current_position') || null,
            current_city: stringField(fields, 'current_city') || null,
            preferred_locations: stringArrayField(fields, 'preferred_locations'),
            salary_expectation: stringField(fields, 'salary_expectation') || null,
            resume_text: text,
          }),
        });
        const importResult = await importResponse.json();
        if (!importResult.success) {
          throw new Error(importResult.error || '入库失败');
        }
        // 入库成功后保存原始简历文件（失败不影响入库结果）
        const candidateId = importResult.data?.id;
        if (typeof candidateId === 'string') {
          try {
            await uploadCandidateResumeFile(candidateId, item.file);
          } catch {
            fileUploadFailed += 1;
          }
        }
        updateItem(item.key, { status: 'done' });
        done += 1;
      } catch (error) {
        updateItem(item.key, {
          status: 'failed',
          error: error instanceof Error ? error.message : '解析入库失败',
        });
        failed += 1;
      }
    }
    setBatchImporting(false);
    if (done > 0) await onImported();
    if (failed === 0 && fileUploadFailed === 0) {
      toast.success(`已全部入库 ${done} 份简历`);
    } else if (failed === 0) {
      toast.warning(
        `已入库 ${done} 份，其中 ${fileUploadFailed} 份原始文件保存失败（详情页仅显示简历摘要）`,
      );
    } else {
      toast.warning(`入库完成：成功 ${done} 份，失败 ${failed} 份，可逐份重试`);
    }
  }

  const doneCount = items.filter(item => item.status === 'done').length;
  const pendingItems = items.filter(item => item.status === 'pending');

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[85vh] max-h-[46rem] max-w-4xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>简历导入预览</DialogTitle>
            <DialogDescription>
              已选择 {items.length} 份简历。点击文件名预览原文，确认后再「解析入库」。
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 gap-4 py-2 md:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.4fr)]">
            {/* 左：文件列表 */}
            <div className="flex min-h-0 flex-col rounded-lg border bg-slate-50/50">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <span className="text-xs font-medium text-slate-500">
                  文件列表（{doneCount}/{items.length} 已入库）
                </span>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-1 p-2">
                  {items.map(item => (
                    <div
                      key={item.key}
                      className={`rounded-lg border p-2 transition ${
                        previewKey === item.key
                          ? 'border-blue-300 bg-blue-50'
                          : 'bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onClick={() => void handlePreview(item)}
                        >
                          {item.status === 'done' ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                          ) : item.status === 'failed' ? (
                            <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                          ) : item.status === 'importing' ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
                          ) : (
                            <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-slate-700">
                              {item.file.name}
                            </span>
                            <span className="block text-xs text-slate-400">
                              {formatBytes(item.file.size)}
                            </span>
                          </span>
                        </button>
                        {item.status === 'done' ? (
                          <Badge variant="outline" className="shrink-0 text-emerald-600">
                            已入库
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            disabled={batchImporting}
                            onClick={() => setImportingItem(item)}
                          >
                            解析入库
                          </Button>
                        )}
                      </div>
                      {item.error && (
                        <p className="mt-1 text-xs text-red-600">{item.error}</p>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
              {pendingItems.length > 1 && (
                <div className="border-t p-3">
                  <Button
                    className="w-full bg-blue-600 hover:bg-blue-700"
                    disabled={batchImporting}
                    onClick={() => void handleBatchImport()}
                  >
                    {batchImporting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {batchImporting
                      ? '正在批量入库…'
                      : `全部解析入库（${pendingItems.length} 份）`}
                  </Button>
                  <p className="mt-1.5 text-center text-xs text-slate-400">
                    按提取的姓名自动入库，绑定
                    {lockedJobId ? '当前职位' : '最近使用的职位'}
                  </p>
                </div>
              )}
            </div>

            {/* 右：原文件预览（不解析字段） */}
            <div className="flex min-h-0 flex-col rounded-lg border">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <span className="truncate text-sm font-medium text-slate-700">
                  {previewName || '未选择文件'}
                </span>
                {previewLoading && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
                )}
              </div>
              {previewError ? (
                <Alert variant="destructive" className="m-3">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>预览失败</AlertTitle>
                  <AlertDescription>{previewError}</AlertDescription>
                </Alert>
              ) : preview?.kind === 'pdf' ? (
                <iframe
                  title={previewName}
                  src={preview.url}
                  className="min-h-0 w-full flex-1 border-0"
                />
              ) : preview?.kind === 'html' ? (
                <iframe
                  title={previewName}
                  sandbox=""
                  srcDoc={preview.html}
                  className="min-h-0 w-full flex-1 border-0 bg-white"
                />
              ) : preview?.kind === 'text' ? (
                <ScrollArea className="min-h-0 flex-1">
                  <pre className="whitespace-pre-wrap px-4 py-3 text-sm leading-6 text-slate-700">
                    {preview.text}
                  </pre>
                </ScrollArea>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-sm text-slate-400">
                  <FileText className="h-8 w-8 text-slate-300" />
                  点击左侧文件预览简历原文件（不进行任何解析）
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QuickImportDialog
        open={importingItem !== null}
        onOpenChange={open => {
          if (!open) setImportingItem(null);
        }}
        file={importingItem?.file ?? null}
        lockedJobId={lockedJobId}
        onImported={handleSingleImported}
      />
    </>
  );
}
