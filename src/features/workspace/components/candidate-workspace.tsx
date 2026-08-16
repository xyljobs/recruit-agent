'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  Briefcase,
  Download,
  Eye,
  FileArchive,
  FileUp,
  Filter,
  Link2,
  Search,
  ShieldOff,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { authFetch } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import { getScoreBg, getScoreColor } from '../constants';
import { useWorkspaceData } from '../hooks/use-workspace-data';
import { exportCandidates } from '../lib/export-workbook';
import {
  collectFilesFromDataTransfer,
  mergeResumeImportFiles,
} from '../lib/resume-file';
import type { Candidate, CandidateForm } from '../types';
import {
  CandidateDetailPanel,
  CandidateFormDialog,
  RevokeCandidateDialog,
  type DuplicateCandidateHint,
} from './candidate-dialogs';
import { ResumeImportPanel } from './resume-import-preview';

function CandidateTableSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4, 5].map((item) => (
        <div key={item} className="flex items-center gap-6 rounded-lg border p-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-5 w-14" />
        </div>
      ))}
    </div>
  );
}

function SortableTableHead({
  label,
  active,
  ascending,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  ascending: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'inline-flex items-center gap-1 transition-colors hover:text-foreground',
          active && 'text-primary hover:text-primary',
        )}
      >
        {label}
        {active &&
          (ascending ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          ))}
      </button>
    </TableHead>
  );
}

type CandidateFilter = 'all' | 'high' | 'job' | 'unbound';

// 简历上传区：多选文件 / 整个文件夹 / 直接拖入三条入口合一（仅简历导入 Tab 使用）
// compact：已有文件待处理时收窄，为下方预览面板让出空间；无文件时铺大方便拖拽
function ResumeDropZone({ onFiles, compact = false }: { onFiles: (files: File[]) => void; compact?: boolean }) {
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  // 挂载即启用 directory 模式（浏览器 API 属性非标准，需手动设置；ref 回调避免条件渲染导致 useEffect 时序错配）
  const folderInputRefCallback = useCallback((el: HTMLInputElement | null) => {
    folderInputRef.current = el;
    if (el) {
      el.setAttribute('webkitdirectory', '');
      el.setAttribute('directory', '');
    }
  }, []);

  // 拖入的文件/文件夹：递归展开目录（含子目录）后再交给上层过滤
  async function handleDrop(dataTransfer: DataTransfer) {
    const list = await collectFilesFromDataTransfer(dataTransfer);
    onFiles(list);
  }

  return (
    <div>
      <div
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed text-sm text-muted-foreground transition-colors cursor-pointer ${
          compact ? 'py-4' : 'min-h-[26rem] py-16'
        } ${
          dragging
            ? 'border-blue-400 bg-blue-50/60'
            : 'border-border hover:border-blue-300 hover:bg-blue-50/30'
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void handleDrop(event.dataTransfer);
        }}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter') fileInputRef.current?.click();
        }}
      >
        <FileUp className={`mb-2 text-blue-500 ${compact ? 'h-6 w-6' : 'h-10 w-10'}`} />
        <span>
          拖拽简历文件或文件夹到此导入（PDF / Word / 文本），或
          <span
            role="button"
            tabIndex={0}
            className="text-blue-600 hover:underline"
            onClick={event => {
              event.stopPropagation();
              fileInputRef.current?.click();
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.stopPropagation();
                fileInputRef.current?.click();
              }
            }}
          >
            点击选择文件
          </span>
          <span className="mx-1 text-muted-foreground">/</span>
          <span
            role="button"
            tabIndex={0}
            className="text-blue-600 hover:underline"
            onClick={event => {
              event.stopPropagation();
              folderInputRef.current?.click();
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.stopPropagation();
                folderInputRef.current?.click();
              }
            }}
          >
            选择整个文件夹
          </span>
        </span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.doc,.txt,.md"
        multiple
        className="hidden"
        onChange={(event) => {
          onFiles(Array.from(event.target.files || []));
          event.target.value = '';
        }}
      />
      <input
        ref={folderInputRefCallback}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          onFiles(Array.from(event.target.files || []));
          event.target.value = '';
        }}
      />
    </div>
  );
}


// library：流程第 2 步「候选人库」，完全跟随当前职位（职位页选过才展示），没选职位显示空态引导；
// pool：右侧独立入口「人才资源池」，全部候选人查询（含未绑定）+ 绑定管理
export function CandidateWorkspace({ variant = 'library' }: { variant?: 'library' | 'pool' } = {}) {
  const { matchRecords, jobs, loading: workspaceLoading, reloadCandidates } = useWorkspaceData();
  const [candidateSearch, setCandidateSearch] = useState('');
  // 库模式初始即「当前职位」，避免先发一次全量请求、再被职位过滤请求覆盖的竞态
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilter>(
    variant === 'library' ? 'job' : 'all',
  );
  // 列表改为组件内按过滤条件分页拉取（接口单页上限 100），搜索/排序仍在前端
  const [listCandidates, setListCandidates] = useState<Candidate[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listTotal, setListTotal] = useState(0);
  const [page, setPage] = useState(1);
  const LIST_PAGE_SIZE = 100;
  // 过期响应守卫：只应用最新一次请求的结果，晚到的旧响应直接丢弃
  const fetchSeqRef = useRef(0);
  // 已打开的候选人详情 Tab：每点一个候选人新开一个可关闭的 Tab（用候选 ID 作 Tab value）
  const [openCandidateTabs, setOpenCandidateTabs] = useState<Candidate[]>([]);
  const [revokeCandidate, setRevokeCandidate] = useState<Candidate | null>(null);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);
  // 资源池：换绑职位
  const [rebindCandidate, setRebindCandidate] = useState<Candidate | null>(null);
  const [rebindJobId, setRebindJobId] = useState<string>('none');
  const [rebindOpen, setRebindOpen] = useState(false);
  const [rebinding, setRebinding] = useState(false);
  // 批量选择（checkbox 多选）与批量撤回授权
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchRevokeOpen, setBatchRevokeOpen] = useState(false);
  const [batchRevokeLoading, setBatchRevokeLoading] = useState(false);
  // 条件删除：仅无匹配记录的候选人可硬删，有留痕的引导走撤回授权
  const [deleteCandidate, setDeleteCandidate] = useState<Candidate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingFiles, setExportingFiles] = useState(false);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  // 库模式页内 Tab：候选人列表 / 简历导入 / 候选人详情（每点一个候选人动态新开一个可关闭的详情 Tab）
  const [activeTab, setActiveTab] = useState<string>('library');
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [formInitialValues, setFormInitialValues] =
    useState<CandidateForm | null>(null);
  const [formDuplicates, setFormDuplicates] = useState<DuplicateCandidateHint[]>(
    [],
  );

  // 当前职位：仅认职位页选择记忆（last_job_id），没选过就不猜测——
  // 否则列表会凭空出现「当前职位：第一个职位」的数据，导入也会绑到没选过的职位
  const currentJobId = useMemo(() => {
    if (variant !== 'library') return null;
    const remembered =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem('last_job_id')
        : null;
    return remembered && jobs.some((job) => job.id === remembered)
      ? remembered
      : null;
  }, [jobs, variant]);
  const currentJob = currentJobId
    ? jobs.find((job) => job.id === currentJobId)
    : undefined;

  // 库模式没选当前职位时不再回退到任何全量视图——候选人库只服务当前职位，
  // 没选职位直接展示空态引导去职位页（渲染层拦截，fetchPage 对 job 筛选也有 currentJobId 守卫）
  const libraryAwaitingJob =
    variant === 'library' && !workspaceLoading && !currentJobId;

  // 按过滤条件分页拉取候选人（服务端按 jobId/unbound 过滤；搜索仍在前端做，保证姓名等加密字段可搜）
  const fetchPage = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(LIST_PAGE_SIZE),
    });
    if (variant === 'library' && candidateFilter === 'job') {
      // 当前职位还没就绪（职位列表加载中/未选过）时先不发请求
      if (!currentJobId) return;
      params.set('jobId', currentJobId);
    }
    if (variant === 'pool' && candidateFilter === 'unbound') {
      params.set('unbound', 'true');
    }
    const seq = ++fetchSeqRef.current;
    setListLoading(true);
    try {
      const response = await authFetch(`/api/candidates?${params.toString()}`);
      const result = await response.json();
      // 晚到的旧响应直接丢弃，避免覆盖 newer 请求的结果（切换筛选/职位时的竞态）
      if (seq !== fetchSeqRef.current) return;
      if (!result.success) {
        toast.error(result.error || '加载候选人失败');
        return;
      }
      setListCandidates(result.data ?? []);
      setListTotal(result.pagination?.total ?? (result.data ?? []).length);
    } catch {
      if (seq === fetchSeqRef.current) toast.error('加载候选人失败');
    } finally {
      if (seq === fetchSeqRef.current) setListLoading(false);
    }
  }, [candidateFilter, currentJobId, page, variant]);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  // 本页 + 全局上下文（其他页面共用 Provider 缓存）同步刷新
  const refreshCandidates = useCallback(async () => {
    await Promise.all([fetchPage(), reloadCandidates()]);
  }, [fetchPage, reloadCandidates]);

  function handleFilterChange(value: string) {
    setCandidateFilter(value as CandidateFilter);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(listTotal / LIST_PAGE_SIZE));

  const filteredCandidates = useMemo(() => {
    let result = listCandidates;
    if (candidateSearch.trim()) {
      const search = candidateSearch.toLowerCase();
      result = result.filter(
        (candidate) =>
          candidate.name.toLowerCase().includes(search) ||
          candidate.current_company?.toLowerCase().includes(search) ||
          candidate.current_position?.toLowerCase().includes(search) ||
          candidate.skills?.some((skill) =>
            skill.toLowerCase().includes(search),
          ),
      );
    }
    if (candidateFilter === 'high') {
      const highMatchIds = new Set(
        matchRecords
          .filter((record) => (record.overall_score || 0) >= 70)
          .map((record) => record.candidate_id),
      );
      result = result.filter((candidate) => highMatchIds.has(candidate.id));
    }
    return result;
  }, [candidateFilter, candidateSearch, listCandidates, matchRecords]);

  const [sortKey, setSortKey] = useState<'score' | 'years' | null>(null);
  const [sortAscending, setSortAscending] = useState(false);

  function toggleSort(key: 'score' | 'years') {
    if (sortKey === key) {
      setSortAscending((previous) => !previous);
    } else {
      setSortKey(key);
      setSortAscending(false);
    }
  }

  const visibleCandidates = useMemo(() => {
    if (!sortKey) return filteredCandidates;
    const scoreByCandidate = new Map<string, number>();
    for (const record of matchRecords) {
      if (typeof record.overall_score === 'number') {
        scoreByCandidate.set(record.candidate_id, record.overall_score);
      }
    }
    const valueOf = (candidate: Candidate) =>
      sortKey === 'score'
        ? (scoreByCandidate.get(candidate.id) ?? -1)
        : (candidate.experience_years ?? -1);
    return [...filteredCandidates].sort((left, right) =>
      sortAscending
        ? valueOf(left) - valueOf(right)
        : valueOf(right) - valueOf(left),
    );
  }, [filteredCandidates, matchRecords, sortAscending, sortKey]);

  // 已产生匹配记录的候选人：删除按钮置灰，提示改用撤回授权
  const matchedCandidateIds = useMemo(
    () =>
      new Set(
        matchRecords
          .filter((record) => record.status !== 'pending')
          .map((record) => record.candidate_id),
      ),
    [matchRecords],
  );

  // 候选人列表刷新（撤回/删除后）时清理失效的选择项
  useEffect(() => {
    setSelectedIds((previous) => {
      const liveIds = new Set(listCandidates.map((candidate) => candidate.id));
      const next = new Set([...previous].filter((id) => liveIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [listCandidates]);

  const allVisibleSelected =
    visibleCandidates.length > 0 &&
    visibleCandidates.every((candidate) => selectedIds.has(candidate.id));

  function toggleCandidateSelected(candidateId: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(candidateId)) {
        next.delete(candidateId);
      } else {
        next.add(candidateId);
      }
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((previous) => {
      if (
        visibleCandidates.length > 0 &&
        visibleCandidates.every((candidate) => previous.has(candidate.id))
      ) {
        return new Set();
      }
      return new Set(visibleCandidates.map((candidate) => candidate.id));
    });
  }

  // 批量撤回授权：逐个调用撤回接口（顺序执行避免触发速率限制），汇总成功/失败
  async function handleBatchRevoke() {
    const targets = listCandidates.filter((candidate) =>
      selectedIds.has(candidate.id),
    );
    if (targets.length === 0) {
      setBatchRevokeOpen(false);
      return;
    }
    setBatchRevokeLoading(true);
    let succeeded = 0;
    const failedNames: string[] = [];
    for (const candidate of targets) {
      try {
        const response = await authFetch(
          `/api/candidates/${candidate.id}/revoke`,
          { method: 'DELETE' },
        );
        const result = await response.json();
        if (result.success) {
          succeeded += 1;
        } else {
          failedNames.push(candidate.name);
        }
      } catch {
        failedNames.push(candidate.name);
      }
    }
    setBatchRevokeLoading(false);
    setBatchRevokeOpen(false);
    setSelectedIds(new Set());
    await refreshCandidates();
    if (failedNames.length === 0) {
      toast.success(`已撤回 ${succeeded} 位候选人的授权`);
    } else {
      toast.warning(
        `撤回成功 ${succeeded} 人，失败 ${failedNames.length} 人：${failedNames.join('、')}`,
      );
    }
  }

  async function handleDelete() {
    if (!deleteCandidate) return;
    setDeleting(true);
    try {
      const response = await authFetch(`/api/candidates/${deleteCandidate.id}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (result.success) {
        toast.success('候选人已删除');
        setDeleteCandidate(null);
        await refreshCandidates();
      } else {
        toast.error(result.error || '删除失败');
      }
    } catch {
      toast.error('删除操作失败');
    } finally {
      setDeleting(false);
    }
  }

  // 资源池：换绑职位（null = 解绑，退回纯资源池状态）
  function openRebind(candidate: Candidate) {
    setRebindCandidate(candidate);
    setRebindJobId(candidate.source_job_id ?? 'none');
    setRebindOpen(true);
  }

  async function handleRebind() {
    if (!rebindCandidate) return;
    setRebinding(true);
    try {
      const response = await authFetch(
        `/api/candidates/${rebindCandidate.id}/binding`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_job_id: rebindJobId === 'none' ? null : rebindJobId,
          }),
        },
      );
      const result = await response.json();
      if (result.success) {
        toast.success(
          rebindJobId === 'none'
            ? `已解绑 ${rebindCandidate.name} 的职位`
            : `已将 ${rebindCandidate.name} 绑定到新职位`,
        );
        setRebindOpen(false);
        setRebindCandidate(null);
        await refreshCandidates();
      } else {
        toast.error(result.error || '换绑失败');
      }
    } catch {
      toast.error('换绑操作失败');
    } finally {
      setRebinding(false);
    }
  }

  // 分页拉取全量候选人：列表页默认只加载 20 条，导出需按 pagination 循环取全，避免导出缺数据
  async function fetchAllCandidatesForExport(): Promise<Candidate[]> {
    const pageSize = 100;
    const allCandidates: Candidate[] = [];
    let page = 1;
    // 安全上限：接口限制页码不超过 10000
    while (page <= 10_000) {
      const response = await authFetch(
        `/api/candidates?page=${page}&pageSize=${pageSize}`,
      );
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || '拉取候选人列表失败');
      }
      const batch = (result.data ?? []) as Candidate[];
      allCandidates.push(...batch);
      const total = result.pagination?.total as number | undefined;
      if (typeof total === 'number' && allCandidates.length >= total) break;
      if (batch.length < pageSize) break;
      page += 1;
    }
    return allCandidates;
  }

  async function handleExport() {
    if (listTotal === 0 && listCandidates.length === 0) {
      toast.error('暂无候选人数据');
      return;
    }
    setExporting(true);
    try {
      // 导出前拉取全量（含原始简历字段），而不是仅导出当前页已加载的 20 条
      const allCandidates = await fetchAllCandidatesForExport();
      await exportCandidates(allCandidates);
      toast.success('导出成功！');
    } catch {
      toast.error('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  }

  // 打包下载原始简历文件：仅包含已上传原文件的候选人，纯文字录入者自动跳过
  async function handleExportResumeFiles() {
    setExportingFiles(true);
    try {
      const response = await authFetch('/api/candidates/export-resume-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        toast.error(result?.error || '导出简历文件失败');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const disposition = response.headers.get('Content-Disposition');
      const encodedName = disposition?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
      link.download = encodedName
        ? decodeURIComponent(encodedName)
        : '候选人简历文件.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('简历文件打包下载已开始');
    } catch {
      toast.error('导出失败，请重试');
    } finally {
      setExportingFiles(false);
    }
  }

  function handleImportFiles(list: File[]) {
    if (list.length === 0) return;
    // 追加合并而非整批替换：再次上传在已有列表上累积，重复文件自动去重
    const merged = mergeResumeImportFiles(importFiles, list);
    const ignoredReasons: string[] = [];
    if (merged.unsupported > 0) ignoredReasons.push(`${merged.unsupported} 个类型不支持`);
    if (merged.oversize > 0) ignoredReasons.push(`${merged.oversize} 个超过 20MB`);
    if (merged.duplicates > 0) ignoredReasons.push(`${merged.duplicates} 个与列表中重复`);
    if (merged.overflow > 0) ignoredReasons.push(`${merged.overflow} 个超出 50 份上限`);
    if (ignoredReasons.length > 0) {
      toast.warning(`已忽略：${ignoredReasons.join('，')}`);
    }
    if (merged.files.length === importFiles.length) return;
    setImportFiles(merged.files);
    setActiveTab('import');
  }

  // 点击候选人或眼睛：若该候选人详情 Tab 已打开则直接激活，否则新开一个 Tab
  function openCandidateDetail(candidate: Candidate) {
    setOpenCandidateTabs((previous) =>
      previous.some((item) => item.id === candidate.id)
        ? previous
        : [...previous, candidate],
    );
    setActiveTab(candidate.id);
  }

  // 关闭某个候选人详情 Tab；若关闭的是当前激活 Tab 则回到列表
  function closeCandidateTab(candidateId: string) {
    setOpenCandidateTabs((previous) =>
      previous.filter((item) => item.id !== candidateId),
    );
    setActiveTab((previous) => (previous === candidateId ? 'library' : previous));
  }

  function handleFormDialogOpenChange(nextOpen: boolean) {
    setFormDialogOpen(nextOpen);
    if (!nextOpen) {
      setFormInitialValues(null);
      setFormDuplicates([]);
    }
  }

  const libraryCard = (
    <Card>
        {/* 标题由页内 Tab 承担（library=候选人库 / pool=人才资源池），页内不再重复标题 */}
        <CardContent>
          {libraryAwaitingJob ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Briefcase className="h-14 w-14 mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-4">
                候选人库跟随当前职位展示，请先在「职位与标准」选择职位
              </p>
              <Button asChild>
                <Link href="/jobs">去选择职位</Link>
              </Button>
            </div>
          ) : (
          <>
          <div className="flex flex-col gap-3 mb-4 sm:flex-row">
            <div className="relative w-80 shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索姓名、公司、职位或技能..."
                className="pl-9"
                value={candidateSearch}
                onChange={(event) => setCandidateSearch(event.target.value)}
              />
            </div>
            <Select
              value={candidateFilter}
              onValueChange={handleFilterChange}
            >
              <SelectTrigger className="w-auto min-w-44 justify-start">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {variant === 'library' && currentJob && (
                  <SelectItem value="job">当前职位：{currentJob.title}</SelectItem>
                )}
                {variant === 'pool' && (
                  <SelectItem value="all">全部候选人</SelectItem>
                )}
                {variant === 'pool' && (
                  <SelectItem value="unbound">未绑定职位</SelectItem>
                )}
                <SelectItem value="high">高匹配度(≥70分)</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={handleExport}
              disabled={exporting}
              className="shrink-0"
            >
              <Download className="h-4 w-4 mr-2" />
              {exporting ? '导出中...' : '导出'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportResumeFiles}
              disabled={exportingFiles}
              className="shrink-0"
            >
              <FileArchive className="h-4 w-4 mr-2" />
              {exportingFiles ? '打包中...' : '导出简历文件'}
            </Button>
          </div>

          {selectedIds.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-2 text-sm">
              <span className="text-foreground">
                已选 <span className="font-bold text-blue-700">{selectedIds.size}</span> 位候选人
              </span>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setBatchRevokeOpen(true)}
              >
                <ShieldOff className="h-4 w-4 mr-1.5" />
                批量撤回授权
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedIds(new Set())}
              >
                清除选择
              </Button>
            </div>
          )}

          {listLoading ? (
            <CandidateTableSkeleton />
          ) : filteredCandidates.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={toggleSelectAllVisible}
                      aria-label="全选当前列表"
                    />
                  </TableHead>
                  <TableHead className="w-52">候选人</TableHead>
                  <TableHead>公司 / 绑定职位</TableHead>
                  <SortableTableHead
                    label="经验年限"
                    active={sortKey === 'years'}
                    ascending={sortAscending}
                    onClick={() => toggleSort('years')}
                    className="w-24"
                  />
                  <TableHead className="w-20">学历</TableHead>
                  <TableHead>技能</TableHead>
                  <SortableTableHead
                    label="匹配评分"
                    active={sortKey === 'score'}
                    ascending={sortAscending}
                    onClick={() => toggleSort('score')}
                    className="w-28"
                  />
                  <TableHead className="w-24">录入人</TableHead>
                  <TableHead className="w-28">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleCandidates.map((candidate) => {
                  const matchRecord = matchRecords.find(
                    (record) => record.candidate_id === candidate.id,
                  );
                  const sourceJob = candidate.source_job_id
                    ? jobs.find((job) => job.id === candidate.source_job_id)
                    : undefined;
                  return (
                    <TableRow
                      key={candidate.id}
                      className="cursor-pointer"
                      onClick={() => openCandidateDetail(candidate)}
                    >
                      <TableCell
                        className="w-10"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          checked={selectedIds.has(candidate.id)}
                          onCheckedChange={() =>
                            toggleCandidateSelected(candidate.id)
                          }
                          aria-label={`选择${candidate.name}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 font-semibold text-white">
                            {candidate.name[0]}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-blue-700 hover:text-blue-900 hover:underline underline-offset-4">
                              {candidate.name}
                            </p>
                            <p className="max-w-40 truncate text-xs text-muted-foreground">
                              {candidate.current_position || '未知职位'}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-foreground">
                          {candidate.current_company || '—'}
                        </p>
                        {sourceJob && (
                          <p className="max-w-48 truncate text-xs text-muted-foreground">
                            绑定：{sourceJob.title}
                            {candidate.source_job_binding_status ===
                              'expired' && (
                              <span className="text-amber-600">（已过期）</span>
                            )}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-foreground">
                        {candidate.experience_years !== null &&
                        candidate.experience_years !== undefined
                          ? `${candidate.experience_years}年`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-foreground">
                        {candidate.education || '—'}
                      </TableCell>
                      <TableCell>
                        {candidate.skills && candidate.skills.length > 0 ? (
                          <div className="flex max-w-64 flex-wrap gap-1">
                            {candidate.skills.slice(0, 3).map((skill) => (
                              <Badge
                                key={skill}
                                variant="secondary"
                                className="text-xs"
                              >
                                {skill}
                              </Badge>
                            ))}
                            {candidate.skills.length > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{candidate.skills.length - 3}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {matchRecord && matchRecord.overall_score != null ? (
                          <span
                            className={cn(
                              'inline-flex rounded-md border px-2 py-0.5 text-sm font-bold',
                              getScoreBg(matchRecord.overall_score),
                              getScoreColor(matchRecord.overall_score),
                            )}
                          >
                            {matchRecord.overall_score}分
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {candidate.created_by_name || '—'}
                      </TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <div className="flex">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`查看${candidate.name}详情`}
                            onClick={() => openCandidateDetail(candidate)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {variant === 'pool' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`换绑${candidate.name}的职位`}
                              title="绑定 / 换绑职位"
                              className="text-primary hover:bg-primary/10 hover:text-primary"
                              onClick={() => openRebind(candidate)}
                            >
                              <Link2 className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => {
                              setRevokeCandidate(candidate);
                              setRevokeConfirmOpen(true);
                            }}
                          >
                            <ShieldOff className="h-4 w-4 mr-1.5" />
                            撤回授权
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`删除${candidate.name}`}
                            title={
                              matchedCandidateIds.has(candidate.id)
                                ? '已有决策记录，为保留留痕请改用「撤回授权」'
                                : '删除候选人'
                            }
                            disabled={matchedCandidateIds.has(candidate.id)}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => {
                              setDeleteCandidate(candidate);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
              <p>
                {candidateSearch || (candidateFilter !== 'job' && candidateFilter !== 'all')
                  ? '未找到匹配的候选人'
                  : candidateFilter === 'job'
                    ? '该职位暂无候选人，可从「简历导入」入库或在「人才资源池」换绑'
                    : '暂无候选人，点击上方按钮添加'}
              </p>
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>共 {listTotal} 位候选人</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || listLoading}
                  onClick={() => setPage((previous) => Math.max(1, previous - 1))}
                >
                  上一页
                </Button>
                <span>
                  第 {page} / {totalPages} 页
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || listLoading}
                  onClick={() =>
                    setPage((previous) => Math.min(totalPages, previous + 1))
                  }
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
          </>
          )}
        </CardContent>
      </Card>
  );

  return (
    <>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* Tabs 根节点自带 gap-2，不再额外加 mb-4 拉开与内容的空隙 */}
        <TabsList>
          <TabsTrigger value="library">
            {variant === 'library' ? '候选人库' : '人才资源池'}
          </TabsTrigger>
          {variant === 'library' && (
            <TabsTrigger value="import">简历导入</TabsTrigger>
          )}
          {openCandidateTabs.map((candidate) => (
            <TabsTrigger key={candidate.id} value={candidate.id}>
              <span className="max-w-32 truncate">{candidate.name}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label={`关闭${candidate.name}详情`}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  closeCandidateTab(candidate.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.stopPropagation();
                    closeCandidateTab(candidate.id);
                  }
                }}
                className="ml-1 inline-flex items-center rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-slate-200 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="library">{libraryCard}</TabsContent>
        {variant === 'library' && (
          /* forceMount：Radix Tabs 切走即卸载组件，导入面板内部文件状态会重置，须常驻只隐藏 */
          <TabsContent value="import" forceMount className="data-[state=inactive]:hidden">
            {/* 导入面板自带边框容器，Card 内边距压缩（原 py-6+pt-6 双层堆叠浪费 48px） */}
            <Card className="gap-4 py-4">
              <CardContent className="flex flex-col gap-4 pt-0">
                <ResumeDropZone onFiles={handleImportFiles} compact={importFiles.length > 0} />
                <ResumeImportPanel
                  files={importFiles}
                  lockedJobId={currentJobId}
                  onImported={refreshCandidates}
                  onAllImported={() => {
                    // 全部入库成功后自动回到列表并清空，免去手动切 Tab
                    setActiveTab('library');
                    setImportFiles([]);
                  }}
                  onRemoveFile={(file) =>
                    setImportFiles((previous) =>
                      previous.filter((item) => item !== file),
                    )
                  }
                  className="flex-none h-[calc(100vh_-_22rem)] min-h-[30rem]"
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}
        {openCandidateTabs.map((candidate) => (
          <TabsContent
            key={candidate.id}
            value={candidate.id}
            forceMount
            className="data-[state=inactive]:hidden"
          >
            <CandidateDetailPanel
              candidate={candidate}
              matchRecord={
                matchRecords.find(
                  (record) => record.candidate_id === candidate.id,
                ) ?? null
              }
              onBack={() => closeCandidateTab(candidate.id)}
            />
          </TabsContent>
        ))}
      </Tabs>

      <RevokeCandidateDialog
        candidate={revokeCandidate}
        open={revokeConfirmOpen}
        onOpenChange={setRevokeConfirmOpen}
      />
      <Dialog open={rebindOpen} onOpenChange={setRebindOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>绑定职位「{rebindCandidate?.name}」</DialogTitle>
            <DialogDescription>
              换绑后候选人将跟随新职位进入对应流程；选择「不绑定」则退回资源池待分配。
            </DialogDescription>
          </DialogHeader>
          <Select value={rebindJobId} onValueChange={setRebindJobId}>
            <SelectTrigger aria-label="选择要绑定的职位">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不绑定（留在资源池）</SelectItem>
              {jobs.map((job) => (
                <SelectItem key={job.id} value={job.id}>
                  {job.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              disabled={rebinding}
              onClick={() => setRebindOpen(false)}
            >
              取消
            </Button>
            <Button disabled={rebinding} onClick={() => void handleRebind()}>
              {rebinding ? '保存中…' : '确认绑定'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={batchRevokeOpen} onOpenChange={setBatchRevokeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>批量撤回授权</DialogTitle>
            <DialogDescription>
              确定要撤回所选 {selectedIds.size}
              位候选人的简历授权吗？撤回后，这些候选人的姓名、联系方式、简历等个人信息会被删除且无法恢复，只保留看不出身份的招聘统计数字。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              disabled={batchRevokeLoading}
              onClick={() => setBatchRevokeOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={batchRevokeLoading}
              onClick={handleBatchRevoke}
            >
              {batchRevokeLoading ? '撤回中…' : '确认撤回'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={deleteCandidate !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteCandidate(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除候选人「{deleteCandidate?.name}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              该候选人尚无决策记录，删除后数据不可恢复（含授权记录与简历文件）。
              如需保留招聘统计数字，请改用「撤回授权」。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              {deleting ? '删除中…' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CandidateFormDialog
        open={formDialogOpen}
        onOpenChange={handleFormDialogOpenChange}
        initialValues={formInitialValues}
        duplicates={formDuplicates}
        hideTrigger
      />
    </>
  );
}
