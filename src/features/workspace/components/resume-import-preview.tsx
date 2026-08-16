'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Trash2,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { authFetch } from '@/lib/auth-client';
import { useWorkspaceData } from '../hooks/use-workspace-data';
import {
  extractResumeTextFromFile,
  previewResumeFile,
  uploadCandidateResumeFile,
  type ResumePreview,
} from '../lib/resume-file';
import type { DuplicateCandidateHint } from './candidate-dialogs';

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

type PipelineStage = 'reading' | 'extracting' | 'ai' | 'ready';

const PARSE_STAGE_INDEX: Record<Exclude<PipelineStage, 'ready'>, number> = {
  reading: 0,
  extracting: 1,
  ai: 2,
};

const PIPELINE_STEPS: { key: string; label: string }[] = [
  { key: 'reading', label: '读取简历' },
  { key: 'extracting', label: '提取字段' },
  { key: 'ai', label: 'AI 解析与去重' },
  { key: 'import', label: '写入候选人库' },
];

/**
 * 解析入库过程指示：读取简历 → 提取字段 → AI 解析与去重 → 写入候选人库。
 * 单份「AI 解析入库」触发后逐步点亮，让用户看到解析正在推进而非卡死。
 */
function ImportPipelineSteps({
  stage,
  importing,
}: {
  stage: PipelineStage;
  importing: boolean;
}) {
  const activeIndex = importing
    ? 3
    : stage === 'ready'
      ? -1
      : PARSE_STAGE_INDEX[stage];
  return (
    <div className="flex flex-wrap items-center gap-y-2 text-xs">
      {PIPELINE_STEPS.map((step, index) => {
        const state =
          index < activeIndex
            ? 'done'
            : index === activeIndex
              ? 'active'
              : 'pending';
        return (
          <Fragment key={step.key}>
            {index > 0 && (
              <div
                className={cn(
                  'h-px w-3 shrink-0 sm:w-4',
                  index <= activeIndex ? 'bg-blue-400' : 'bg-slate-200',
                )}
              />
            )}
            <div className="flex shrink-0 items-center gap-1.5">
              {state === 'done' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : state === 'active' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
              ) : (
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-300 text-[10px] leading-none text-slate-400">
                  {index + 1}
                </span>
              )}
              <span
                className={cn(
                  state === 'done'
                    ? 'text-emerald-600'
                    : state === 'active'
                      ? 'font-medium text-blue-600'
                      : 'text-slate-400',
                )}
              >
                {step.label}
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * 流式调用字段提取接口：本地字段就绪推进到「AI 解析」阶段，AI 合并完成后推进到「ready」。
 * 供批量入库复用 ImportPipelineSteps 展示逐步过程；流异常中断时回退非流式重试一次。
 */
async function extractFieldsWithProgress(
  text: string,
  onStage: (stage: PipelineStage) => void,
): Promise<Record<string, unknown>> {
  onStage('extracting');
  const response = await authFetch('/api/candidates/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, stream: true }),
  });
  if (!response.ok || !response.body) {
    throw new Error('字段提取失败');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fields: Record<string, unknown> = {};
  let seenLocal = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: {
        type?: string;
        fields?: Record<string, unknown>;
        extracted?: Record<string, unknown>;
      };
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (event.type === 'local' && event.fields) {
        seenLocal = true;
        fields = event.fields;
        onStage('ai');
      } else if (event.type === 'done') {
        if (event.extracted) fields = event.extracted;
        onStage('ready');
      }
    }
  }
  if (!seenLocal) {
    const fallback = await authFetch('/api/candidates/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const result = await fallback.json();
    if (!result.success) throw new Error(result.error || '字段提取失败');
    fields = (result.data?.extracted ?? {}) as Record<string, unknown>;
    onStage('ready');
  }
  return fields;
}

/**
 * 单份「AI 解析入库」内联确认表单：渲染在简历预览下方（不弹二级窗口）。
 * 挂载即解析文件 → 提取字段 → 极简确认（姓名 + 关联职位 + 获取方式）→ 一键入库。
 * 授权证据由服务端默认登记（招聘平台授权记录、保留 1 年、人工复核优先）。
 */
function QuickImportInlineForm({
  file,
  lockedJobId,
  onImported,
  onCancel,
}: {
  file: File;
  lockedJobId?: string | null;
  onImported: () => Promise<void>;
  onCancel: () => void;
}) {
  const { jobs } = useWorkspaceData();
  const [phase, setPhase] = useState<'parsing' | 'confirm' | 'error'>('parsing');
  const [errorMessage, setErrorMessage] = useState('');
  const [fullText, setFullText] = useState('');
  const [name, setName] = useState('');
  const [jobId, setJobId] = useState('');
  const [extracted, setExtracted] = useState<Record<string, unknown>>({});
  const [duplicates, setDuplicates] = useState<DuplicateCandidateHint[]>([]);
  const [importing, setImporting] = useState(false);
  // 解析入库过程指示：读取简历 → 提取字段 → AI 解析与去重 → 写入候选人库
  const [stage, setStage] = useState<PipelineStage>('reading');
  // AI 深度解析仍在后台进行：本地提取字段先行进入确认表单，解析完成后自动补全
  const [aiRefining, setAiRefining] = useState(false);
  const [refineElapsed, setRefineElapsed] = useState(0);
  const nameEditedByUserRef = useRef(false);
  const [acquisitionType, setAcquisitionType] = useState<
    'candidate_submitted' | 'proactively_sourced'
  >('candidate_submitted');

  // 职位预选兜底：lockedJobId / last_job_id 均无（从未在职位页选过）时取第一个活跃职位，
  // 避免确认阶段「关联职位」为空导致一键入库被静默拦截；HR 可在下拉中改选
  useEffect(() => {
    if (phase !== 'confirm') return;
    if (jobId && !jobs.some((job) => job.id === jobId && job.status === 'active')) {
      // 记忆指向已停用/已删除的职位（下拉中不存在会显示空白）：清空走兜底
      setJobId('');
      return;
    }
    if (!jobId) {
      const fallback = jobs.find((job) => job.status === 'active');
      if (fallback) setJobId(fallback.id);
    }
  }, [phase, jobId, jobs]);

  // AI 深度解析计时：进入 refining 即每秒累计，结束停止
  useEffect(() => {
    if (!aiRefining) return;
    const timer = window.setInterval(() => {
      setRefineElapsed((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [aiRefining]);

  // 挂载即开始解析：浏览器端提取文本 → 流式调提取接口
  // 本地字段（秒级）一到即进入确认表单，AI 深度解析在后台继续并自动补全
  useEffect(() => {
    let active = true;
    setPhase('parsing');
    setErrorMessage('');
    setDuplicates([]);
    setExtracted({});
    setFullText('');
    setAiRefining(false);
    setRefineElapsed(0);
    setStage('reading');
    nameEditedByUserRef.current = false;
    // 预选职位：从职位页发起时锁定该职位，否则取最近操作的职位
    setJobId(lockedJobId ?? sessionStorage.getItem('last_job_id') ?? '');
    void (async () => {
      try {
        const text = await extractResumeTextFromFile(file);
        if (text.trim().length < 10) {
          throw new Error('未能从文件中提取到有效文本（可能是扫描件图片型 PDF）');
        }
        setStage('extracting');
        const response = await authFetch('/api/candidates/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, stream: true }),
        });
        if (!response.ok || !response.body) {
          const result = await response.json().catch(() => null);
          throw new Error(
            (result && typeof result.error === 'string' && result.error) ||
              '字段提取失败',
          );
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let seenLocal = false;
        const applyFields = (fields: Record<string, unknown>) => {
          if (!active) return;
          setExtracted(fields);
          if (!nameEditedByUserRef.current) {
            setName(
              typeof fields.name === 'string' && fields.name
                ? fields.name
                : '',
            );
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let event: {
              type?: string;
              fields?: Record<string, unknown>;
              extracted?: Record<string, unknown>;
              duplicates?: unknown;
              message?: string;
            };
            try {
              event = JSON.parse(trimmed);
            } catch {
              continue;
            }
            if (!active) return;
            if (event.type === 'local' && event.fields) {
              seenLocal = true;
              applyFields(event.fields);
              setFullText(text);
              setPhase('confirm');
              setAiRefining(true);
              setStage('ai');
            } else if (event.type === 'done') {
              setAiRefining(false);
              setStage('ready');
              if (event.extracted) applyFields(event.extracted);
              if (Array.isArray(event.duplicates)) {
                setDuplicates(event.duplicates as DuplicateCandidateHint[]);
              }
            } else if (event.type === 'error') {
              setAiRefining(false);
              if (seenLocal) {
                // 已有本地字段兜底：不阻断入库，提示 AI 补全失败即可
                toast.warning('AI 深度解析未完成，已按本地提取字段入库');
              } else {
                throw new Error(
                  typeof event.message === 'string'
                    ? event.message
                    : '字段提取失败',
                );
              }
            }
          }
        }
        if (!active) return;
        if (!seenLocal) {
          // 兜底：流异常中断且未收到任何字段时走非流式重试一次
          const fallback = await authFetch('/api/candidates/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });
          const result = await fallback.json();
          if (!result.success) throw new Error(result.error || '字段提取失败');
          applyFields((result.data?.extracted ?? {}) as Record<string, unknown>);
          setFullText(text);
          setDuplicates(
            Array.isArray(result.data?.duplicates)
              ? (result.data.duplicates as DuplicateCandidateHint[])
              : [],
          );
          setPhase('confirm');
          setStage('ready');
        }
      } catch (error) {
        if (active) {
          // 读流中断（服务重启窗口）为 TypeError，映射为友好文案
          setErrorMessage(
            error instanceof TypeError
              ? '服务连接中断，请稍后重试'
              : error instanceof Error
                ? error.message
                : '简历解析失败',
          );
          setPhase('error');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [file, lockedJobId]);

  async function handleImport() {
    if (!name.trim()) {
      toast.error('请确认候选人姓名');
      return;
    }
    if (!jobId) {
      toast.error('请选择关联职位');
      return;
    }
    setImporting(true);
    try {
      const response = await authFetch('/api/candidates/quick-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: stringField(extracted, 'email') || null,
          phone: stringField(extracted, 'phone') || null,
          source_job_id: jobId,
          acquisition_type: acquisitionType,
          skills: stringArrayField(extracted, 'skills'),
          experience_years:
            typeof extracted.experience_years === 'number'
              ? (extracted.experience_years as number)
              : null,
          education: stringField(extracted, 'education') || null,
          current_company: stringField(extracted, 'current_company') || null,
          current_position: stringField(extracted, 'current_position') || null,
          current_city: stringField(extracted, 'current_city') || null,
          preferred_locations: stringArrayField(extracted, 'preferred_locations'),
          salary_expectation: stringField(extracted, 'salary_expectation') || null,
          resume_text: fullText,
        }),
      });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error || '导入失败');
        return;
      }
      // 入库成功后保存原始简历文件（含自动重试）；失败静默，仅在成功提示中温和补充
      const candidateId = result.data?.id;
      let fileSaved = true;
      if (typeof candidateId === 'string') {
        try {
          await uploadCandidateResumeFile(candidateId, file);
        } catch {
          fileSaved = false;
        }
      }
      if (fileSaved) {
        toast.success('候选人已导入并绑定职位');
      } else {
        toast.info('候选人已导入并绑定职位，原始文件可稍后在候选人详情中补传');
      }
      await onImported();
    } catch {
      toast.error('导入失败，请重试');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="shrink-0 border-t px-3 py-3">
      {phase === 'parsing' && (
        <div className="space-y-2 py-1">
          <ImportPipelineSteps stage={stage} importing={importing} />
          <div className="text-xs text-muted-foreground">
            {stage === 'reading' ? '正在读取简历文件…' : '正在提取基础字段…'}
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-2">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>解析失败</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              关闭
            </Button>
          </div>
        </div>
      )}

      {phase === 'confirm' && (
        <div className="space-y-3">
          <ImportPipelineSteps stage={stage} importing={importing} />
          {aiRefining && (
            <div className="flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs text-blue-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              AI 正在深度解析技能与经历字段，可先确认下方信息（{refineElapsed}
              s）
            </div>
          )}
          {duplicates.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>该候选人可能已存在</AlertTitle>
              <AlertDescription className="space-y-1 text-xs">
                {duplicates.map((item) => (
                  <p key={item.id}>
                    {item.name}
                    {item.source_job_title
                      ? `（曾绑定：${item.source_job_title}${item.source_job_binding_status === 'expired' ? '，已过期' : ''}）`
                      : ''}
                  </p>
                ))}
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-44">
              <Label htmlFor="quick_import_name">姓名 *</Label>
              <Input
                id="quick_import_name"
                value={name}
                onChange={(event) => {
                  nameEditedByUserRef.current = true;
                  setName(event.target.value);
                }}
                placeholder="提取到的姓名，可修改"
              />
            </div>
            <div className="min-w-56 flex-1">
              <Label>关联职位 *</Label>
              <Select
                value={jobId}
                onValueChange={setJobId}
                disabled={Boolean(lockedJobId)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择候选人应聘的职位" />
                </SelectTrigger>
                <SelectContent>
                  {jobs
                    .filter((job) => job.status === 'active')
                    .map((job) => (
                      <SelectItem key={job.id} value={job.id}>
                        {job.title}
                        {job.department ? ` · ${job.department}` : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>简历获取方式 *</Label>
              <RadioGroup
                value={acquisitionType}
                onValueChange={(value) =>
                  setAcquisitionType(
                    value === 'proactively_sourced'
                      ? 'proactively_sourced'
                      : 'candidate_submitted',
                  )
                }
                className="mt-1 flex-row items-start gap-4"
              >
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem value="candidate_submitted" id="acq_submitted" />
                    <Label
                      htmlFor="acq_submitted"
                      className="cursor-pointer font-normal text-slate-700"
                    >
                      候选人主动投递/发送
                    </Label>
                  </div>
                  {acquisitionType === 'candidate_submitted' && (
                    <p className="pl-[22px] text-xs text-muted-foreground">
                      投递型：入库即启用 AI 辅助评估，最终录用由人工决定
                    </p>
                  )}
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem value="proactively_sourced" id="acq_sourced" />
                    <Label
                      htmlFor="acq_sourced"
                      className="cursor-pointer font-normal text-slate-700"
                    >
                      主动搜索获取
                    </Label>
                  </div>
                  {acquisitionType === 'proactively_sourced' && (
                    <p className="pl-[22px] text-xs text-muted-foreground">
                      搜索型：仅人工评估，候选人同意后再开启 AI 评估
                    </p>
                  )}
                </div>
              </RadioGroup>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs leading-5 text-muted-foreground">
              入库后自动登记招聘平台授权记录（即刻生效、默认保留 1
              年）；姓名与联系方式加密存储，证明材料可在候选人详情中补充。
            </p>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" onClick={onCancel} disabled={importing}>
                取消
              </Button>
              <Button onClick={handleImport} disabled={importing}>
                {importing ? '导入中...' : '一键入库'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 简历导入面板：展示文件列表与原文预览，不做任何自动解析。
 * 用户逐份点击「解析入库」（确认姓名与职位），或多个文件时批量入库：勾选了文件仅入库勾选项，未勾选则入库全部。
 * 可独立嵌入整页 Tab（候选人库），也可被 ImportPreviewDialog 包进大尺寸弹窗（职位页）。
 */
export function ResumeImportPanel({
  files,
  lockedJobId,
  onImported,
  onAllImported,
  onRemoveFile,
  className,
}: {
  files: File[];
  lockedJobId?: string | null;
  onImported: () => Promise<void>;
  /** 全部文件入库成功后回调（宿主可据此自动返回列表页） */
  onAllImported?: () => void;
  /** 从导入列表移除一份文件（宿主从 files 状态中剔除；已入库条目仅移除显示，不影响库内数据） */
  onRemoveFile: (file: File) => void;
  className?: string;
}) {
  const [items, setItems] = useState<ImportItem[]>([]);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState('');
  const [preview, setPreview] = useState<ResumePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [importingItem, setImportingItem] = useState<ImportItem | null>(null);
  const [batchImporting, setBatchImporting] = useState(false);
  // 批量入库进度（第 index/total 份）：逐份 AI 提取约需 20 秒，无进度反馈会被误认为卡死
  const [batchProgress, setBatchProgress] = useState<{
    index: number;
    total: number;
  } | null>(null);
  // 批量入库当前文件的阶段与写库标记：复用 ImportPipelineSteps 展示逐步过程
  const [batchStage, setBatchStage] = useState<PipelineStage>('reading');
  const [batchWriting, setBatchWriting] = useState(false);
  // 文件勾选（按条目 key），用于批量移除与批量入库；解析中的条目不可勾选/移除
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [batchAcquisitionType, setBatchAcquisitionType] = useState<
    'candidate_submitted' | 'proactively_sourced'
  >('candidate_submitted');
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

  // 文件列表变化时重建条目（仅登记，不解析）；
  // 追加 / 移除文件时按文件身份保留已有条目的入库状态与预览，不把已入库的打回待处理
  useEffect(() => {
    const keyOf = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;
    setItems(previous => {
      const previousByKey = new Map(previous.map(item => [item.key, item]));
      return files.map(file => {
        const key = keyOf(file);
        const existing = previousByKey.get(key);
        return existing
          ? { ...existing, key, file }
          : { key, file, status: 'pending' as const };
      });
    });
    // 预览与进行中的解析：对应文件仍在列表中则保留，否则复位
    const keySet = new Set(files.map(keyOf));
    setPreviewKey(previous => (previous && keySet.has(previous) ? previous : null));
    setImportingItem(previous =>
      previous && keySet.has(previous.key) ? previous : null,
    );
    // 勾选集合同步剪枝：文件被移除后清掉对应勾选
    setSelectedKeys(previous => {
      const next = new Set([...previous].filter(key => keySet.has(key)));
      return next.size === previous.size ? previous : next;
    });
  }, [files]);

  // 预览区内容跟随 previewKey：预览被复位（文件已不在列表）时清空展示
  useEffect(() => {
    if (!previewKey) {
      setPreviewName('');
      setPreview(null);
      setPreviewError('');
    }
  }, [previewKey]);

  function updateItem(key: string, patch: Partial<ImportItem>) {
    setItems(prev =>
      prev.map(item => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  function toggleSelected(key: string) {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  /** 批量移除勾选文件（仅从导入列表移除显示，已入库条目不影响库内数据） */
  function handleBatchRemove() {
    const toRemove = items.filter(
      item => selectedKeys.has(item.key) && item.status !== 'importing',
    );
    if (toRemove.length === 0) return;
    for (const item of toRemove) {
      onRemoveFile(item.file);
    }
    setSelectedKeys(new Set());
    toast.success(`已从列表移除 ${toRemove.length} 份文件`);
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
      const allDone = items.every(
        item => item.key === importingItem.key || item.status === 'done',
      );
      await onImported();
      if (allDone) onAllImported?.();
    }
    setImportingItem(null);
  }

  /** 逐份提取文本 + 字段提取 + 自动入库；绑定当前职位或最近使用的职位 */
  async function handleBatchImport() {
    const jobId =
      lockedJobId ?? sessionStorage.getItem('last_job_id') ?? '';
    if (!jobId) {
      toast.error('未找到可绑定的职位：请先打开某个职位，或逐份「AI 解析入库」时手动选择');
      return;
    }
    // 有勾选时仅入库勾选的待处理文件，无勾选时入库全部待处理文件
    const pendingItems = items.filter(
      item =>
        item.status === 'pending' &&
        (selectedKeys.size === 0 || selectedKeys.has(item.key)),
    );
    setBatchImporting(true);
    let done = 0;
    let failed = 0;
    let fileUploadFailed = 0;
    const succeededKeys = new Set<string>();
    try {
      for (let index = 0; index < pendingItems.length; index += 1) {
        const item = pendingItems[index];
        setBatchProgress({ index: index + 1, total: pendingItems.length });
        setBatchStage('reading');
        setBatchWriting(false);
        updateItem(item.key, { status: 'importing', error: undefined });
        try {
        const text = await extractResumeTextFromFile(item.file);
        if (text.trim().length < 10) {
          throw new Error('未能提取到有效文本（可能是扫描件图片型 PDF）');
        }
        const fields = await extractFieldsWithProgress(text, setBatchStage);
        const name =
          typeof fields.name === 'string' ? fields.name.trim() : '';
        if (!name) {
          throw new Error('未识别出候选人姓名');
        }
        setBatchWriting(true);
        const importResponse = await authFetch('/api/candidates/quick-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email: stringField(fields, 'email') || null,
            phone: stringField(fields, 'phone') || null,
            source_job_id: jobId,
            acquisition_type: batchAcquisitionType,
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
        // 入库成功后保存原始简历文件（含自动重试）；失败静默，仅在最终提示中温和补充
        const candidateId = importResult.data?.id;
        if (typeof candidateId === 'string') {
          try {
            await uploadCandidateResumeFile(candidateId, item.file);
          } catch {
            fileUploadFailed += 1;
          }
        }
        updateItem(item.key, { status: 'done' });
        succeededKeys.add(item.key);
        done += 1;
      } catch (error) {
        updateItem(item.key, {
          status: 'failed',
          error: error instanceof Error ? error.message : '解析入库失败',
        });
        failed += 1;
      }
      }
    } finally {
      setBatchProgress(null);
      setBatchWriting(false);
      setBatchStage('reading');
    }
    setBatchImporting(false);
    if (done > 0) await onImported();
    if (failed === 0 && fileUploadFailed === 0) {
      toast.success(`已入库 ${done} 份简历`);
    } else if (failed === 0) {
      toast.info(`已入库 ${done} 份简历，部分原始文件可稍后在候选人详情中补传`);
    } else {
      toast.warning(`入库完成：成功 ${done} 份，失败 ${failed} 份，可逐份重试`);
    }
    // 批量目标全部成功且列表内已无待处理/失败条目时才通知宿主（部分勾选入库不触发）
    const hasFailedItem =
      failed > 0 || items.some(item => item.status === 'failed');
    const allDone = items.every(
      item => item.status === 'done' || succeededKeys.has(item.key),
    );
    if (!hasFailedItem && allDone && items.length > 0) {
      onAllImported?.();
    }
  }

  const doneCount = items.filter(item => item.status === 'done').length;
  const pendingItems = items.filter(item => item.status === 'pending');
  const selectableItems = items.filter(item => item.status !== 'importing');
  const allSelected =
    selectableItems.length > 0 &&
    selectableItems.every(item => selectedKeys.has(item.key));
  const selectedCount = selectableItems.filter(item =>
    selectedKeys.has(item.key),
  ).length;
  // 批量入库目标：有勾选时仅勾选中的待处理文件，无勾选时为全部待处理文件
  const batchTargetItems =
    selectedCount > 0
      ? pendingItems.filter(item => selectedKeys.has(item.key))
      : pendingItems;
  // 批量入库当前正在处理的文件名（供进度区展示）
  const batchCurrentName =
    items.find(item => item.status === 'importing')?.file.name ?? '';

  // 无文件时不渲染占位空态（拖拽上传区已由宿主页提供，避免双占位区）
  if (items.length === 0) return null;

  return (
    <div className={cn('grid min-h-0 flex-1 gap-4 md:grid-cols-[320px_minmax(0,1fr)]', className)}>
        {/* 左：文件列表 */}
        <div className="flex min-h-0 flex-col rounded-lg border bg-slate-50/50">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-500">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-600"
                checked={allSelected}
                disabled={batchImporting || selectableItems.length === 0}
                onChange={() =>
                  setSelectedKeys(
                    allSelected
                      ? new Set()
                      : new Set(selectableItems.map(item => item.key)),
                  )
                }
              />
              文件列表（{doneCount}/{items.length} 已入库）
            </label>
            {selectedCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                disabled={batchImporting}
                onClick={handleBatchRemove}
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除所选（{selectedCount}）
              </Button>
            )}
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1 p-2">
              {items.map(item => (
                <div
                  key={item.key}
                  className={`rounded-lg border p-2 transition ${
                    previewKey === item.key
                      ? 'border-blue-300 bg-blue-50'
                      : 'bg-card'
                  }`}
                >
                  <div className="flex items-start gap-1.5">
                    <input
                      type="checkbox"
                      aria-label={`选中 ${item.file.name}`}
                      className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-600"
                      checked={selectedKeys.has(item.key)}
                      disabled={batchImporting || item.status === 'importing'}
                      onChange={() => toggleSelected(item.key)}
                    />
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-start gap-2 text-left"
                      onClick={() => void handlePreview(item)}
                    >
                      {item.status === 'done' ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      ) : item.status === 'failed' ? (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                      ) : item.status === 'importing' ? (
                        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-blue-500" />
                      ) : (
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                      )}
                      <span className="min-w-0">
                        <span className="block break-all text-sm leading-5 text-slate-700">
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
                        AI 解析入库
                      </Button>
                    )}
                    <button
                      type="button"
                      aria-label="从列表删除"
                      title="从列表删除"
                      className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                      disabled={batchImporting || item.status === 'importing'}
                      onClick={() => onRemoveFile(item.file)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {item.error && (
                    <p className="mt-1 text-xs text-red-600">{item.error}</p>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
          {/* 批量入库进行中也保留本区域：否则条目转为 importing 后区域整体卸载，
              进度文案与获取方式选择随之消失，用户只剩行内小转圈、体感即"卡死" */}
          {(pendingItems.length > 0 || batchImporting) && (
            <div className="space-y-2 border-t p-3">
              <div>
                <Label className="text-xs text-slate-500">简历获取方式</Label>
                <RadioGroup
                  disabled={batchImporting}
                  value={batchAcquisitionType}
                  onValueChange={(value) =>
                    setBatchAcquisitionType(
                      value === 'proactively_sourced'
                        ? 'proactively_sourced'
                        : 'candidate_submitted',
                    )
                  }
                  className="mt-1 flex-row items-start gap-4"
                >
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value="candidate_submitted" id="batch_acq_submitted" />
                      <Label
                        htmlFor="batch_acq_submitted"
                        className="cursor-pointer font-normal text-slate-700"
                      >
                        主动投递/发送
                      </Label>
                    </div>
                    {batchAcquisitionType === 'candidate_submitted' && (
                      <p className="pl-[22px] text-xs text-slate-400">
                        批量入库启用 AI 辅助评估，最终录用由人工决定
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value="proactively_sourced" id="batch_acq_sourced" />
                      <Label
                        htmlFor="batch_acq_sourced"
                        className="cursor-pointer font-normal text-slate-700"
                      >
                        主动搜索获取
                      </Label>
                    </div>
                    {batchAcquisitionType === 'proactively_sourced' && (
                      <p className="pl-[22px] text-xs text-slate-400">
                        批量入库仅人工评估，候选人同意后再开启 AI 评估
                      </p>
                    )}
                  </div>
                </RadioGroup>
              </div>
              {batchImporting && batchProgress && (
                <div className="space-y-1.5 rounded-md border border-blue-100 bg-blue-50/60 p-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在处理第 {batchProgress.index}/{batchProgress.total} 份
                    {batchCurrentName ? `：${batchCurrentName}` : ''}
                  </div>
                  <ImportPipelineSteps stage={batchStage} importing={batchWriting} />
                </div>
              )}
              <Button
                className="w-full"
                disabled={batchImporting || batchTargetItems.length === 0}
                onClick={() => void handleBatchImport()}
              >
                {batchImporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {batchImporting
                  ? '正在批量入库…'
                  : selectedCount > 0
                    ? `AI 解析入库所选（${batchTargetItems.length} 份）`
                    : `全部 AI 解析入库（${batchTargetItems.length} 份）`}
              </Button>
              <p className="text-center text-xs text-slate-400">
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
              className="min-h-0 w-full flex-1 border-0 bg-card"
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
          {/* 单份「AI 解析入库」确认表单：内联在简历预览下方，不弹二级窗口 */}
          {importingItem && (
            <QuickImportInlineForm
              key={importingItem.key}
              file={importingItem.file}
              lockedJobId={lockedJobId}
              onImported={handleSingleImported}
              onCancel={() => setImportingItem(null)}
            />
          )}
        </div>
      </div>
  );
}

/**
 * 大尺寸弹窗宿主（职位页等上下文内导入）：近全屏宽度，内部复用 ResumeImportPanel。
 */
export function ImportPreviewDialog({
  open,
  onOpenChange,
  files,
  lockedJobId,
  onImported,
  onRemoveFile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: File[];
  lockedJobId?: string | null;
  onImported: () => Promise<void>;
  onRemoveFile: (file: File) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[92vh] max-h-none flex-col overflow-hidden"
        style={{ width: 'min(1400px, 94vw)', maxWidth: 'min(1400px, 94vw)' }}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>简历导入预览</DialogTitle>
          <DialogDescription>
            已选择 {files.length} 份简历。点击文件名预览原文，确认后再「AI 解析入库」。
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col py-2">
          <ResumeImportPanel
            files={files}
            lockedJobId={lockedJobId}
            onImported={onImported}
            onRemoveFile={onRemoveFile}
          />
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
