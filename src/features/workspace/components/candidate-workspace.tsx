'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Download,
  Eye,
  FileUp,
  Filter,
  Search,
  ShieldOff,
  Trash2,
  Users,
  Wand2,
  Zap,
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
  CardDescription,
  CardHeader,
  CardTitle,
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
import { Textarea } from '@/components/ui/textarea';
import { authFetch } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import { getScoreBg, getScoreColor } from '../constants';
import { useWorkspaceData } from '../hooks/use-workspace-data';
import { exportCandidates } from '../lib/export-workbook';
import { collectFilesFromDataTransfer } from '../lib/resume-file';
import type { Candidate, CandidateForm } from '../types';
import {
  CandidateDetailDialog,
  CandidateFormDialog,
  EMPTY_CANDIDATE_FORM,
  RevokeCandidateDialog,
  type DuplicateCandidateHint,
} from './candidate-dialogs';
import { ImportPreviewDialog } from './resume-import-preview';

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
          'inline-flex items-center gap-1 transition-colors hover:text-gray-900',
          active && 'text-blue-700 hover:text-blue-800',
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

export function CandidateWorkspace() {
  const { candidates, matchRecords, loading, jobs, reloadCandidates } =
    useWorkspaceData();
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidateFilter, setCandidateFilter] = useState<'all' | 'high'>('all');
  const [selectedCandidate, setSelectedCandidate] =
    useState<Candidate | null>(null);
  const [candidateDetailOpen, setCandidateDetailOpen] = useState(false);
  const [revokeCandidate, setRevokeCandidate] = useState<Candidate | null>(null);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);
  // 批量选择（checkbox 多选）与批量撤回授权
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchRevokeOpen, setBatchRevokeOpen] = useState(false);
  const [batchRevokeLoading, setBatchRevokeLoading] = useState(false);
  // 条件删除：仅无匹配记录的候选人可硬删，有留痕的引导走撤回授权
  const [deleteCandidate, setDeleteCandidate] = useState<Candidate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddText, setQuickAddText] = useState('');
  const [quickAddLoading, setQuickAddLoading] = useState(false);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);
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
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [formInitialValues, setFormInitialValues] =
    useState<CandidateForm | null>(null);
  const [formDuplicates, setFormDuplicates] = useState<DuplicateCandidateHint[]>(
    [],
  );

  const filteredCandidates = useMemo(() => {
    let result = candidates;
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
  }, [candidateFilter, candidateSearch, candidates, matchRecords]);

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
    () => new Set(matchRecords.map((record) => record.candidate_id)),
    [matchRecords],
  );

  // 候选人列表刷新（撤回/删除后）时清理失效的选择项
  useEffect(() => {
    setSelectedIds((previous) => {
      const liveIds = new Set(candidates.map((candidate) => candidate.id));
      const next = new Set([...previous].filter((id) => liveIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [candidates]);

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
    const targets = candidates.filter((candidate) =>
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
    await reloadCandidates();
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
        await reloadCandidates();
      } else {
        toast.error(result.error || '删除失败');
      }
    } catch {
      toast.error('删除操作失败');
    } finally {
      setDeleting(false);
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
    if (candidates.length === 0) {
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

  function handleImportFiles(list: File[]) {
    if (list.length === 0) return;
    const supported = list.filter(file =>
      ['.pdf', '.docx', '.doc', '.txt', '.md'].some(ext =>
        file.name.toLowerCase().endsWith(ext),
      ),
    );
    const accepted = supported
      .filter(file => file.size <= 20 * 1024 * 1024)
      .slice(0, 50);
    const skipped = list.length - accepted.length;
    if (skipped > 0) {
      toast.warning(
        `已忽略 ${skipped} 个文件（仅支持 PDF/Word/文本，单份不超过 20MB，单次最多 50 份）`,
      );
    }
    if (accepted.length === 0) return;
    setImportFiles(accepted);
    setImportPreviewOpen(true);
  }

  // 拖入的文件/文件夹：递归展开目录（含子目录）后再过滤
  async function handleDrop(dataTransfer: DataTransfer) {
    const list = await collectFilesFromDataTransfer(dataTransfer);
    handleImportFiles(list);
  }

  async function handleQuickExtract() {
    const text = quickAddText.trim();
    if (!text) {
      toast.error('请先粘贴简历文本');
      return;
    }
    setQuickAddLoading(true);
    try {
      const response = await authFetch('/api/candidates/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error || '提取失败');
        return;
      }
      const extracted = result.data?.extracted as Record<string, unknown>;
      const duplicates = Array.isArray(result.data?.duplicates)
        ? (result.data.duplicates as DuplicateCandidateHint[])
        : [];
      const stringField = (value: unknown) =>
        typeof value === 'string' ? value : '';
      const stringArrayField = (value: unknown) =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : [];
      setFormInitialValues({
        ...EMPTY_CANDIDATE_FORM,
        name: stringField(extracted?.name),
        phone: stringField(extracted?.phone),
        email: stringField(extracted?.email),
        current_city: stringField(extracted?.current_city),
        current_company: stringField(extracted?.current_company),
        current_position: stringField(extracted?.current_position),
        skills: stringArrayField(extracted?.skills),
        experience_years:
          typeof extracted?.experience_years === 'number'
            ? (extracted.experience_years as number)
            : 0,
        education: stringField(extracted?.education),
        salary_expectation: stringField(extracted?.salary_expectation),
        preferred_locations: stringArrayField(extracted?.preferred_locations),
        resume_text: text,
      });
      setFormDuplicates(duplicates);
      setQuickAddOpen(false);
      setQuickAddText('');
      setFormDialogOpen(true);
      toast.success(
        duplicates.length > 0
          ? '提取完成，检测到可能重复的候选人，请核对'
          : '提取完成，请确认字段后保存',
      );
    } catch {
      toast.error('提取失败，请重试');
    } finally {
      setQuickAddLoading(false);
    }
  }

  function handleFormDialogOpenChange(nextOpen: boolean) {
    setFormDialogOpen(nextOpen);
    if (!nextOpen) {
      setFormInitialValues(null);
      setFormDuplicates([]);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>候选人库</CardTitle>
            <CardDescription>管理和筛选候选人信息</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setQuickAddOpen(true)}
            >
              <Zap className="h-4 w-4 mr-2" />
              快捷入库
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exporting}
            >
              <Download className="h-4 w-4 mr-2" />
              {exporting ? '导出中...' : '导出'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 mb-4 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="搜索姓名、公司、职位或技能..."
                className="pl-9"
                value={candidateSearch}
                onChange={(event) => setCandidateSearch(event.target.value)}
              />
            </div>
            <Select
              value={candidateFilter}
              onValueChange={(value) =>
                setCandidateFilter(value as 'all' | 'high')
              }
            >
              <SelectTrigger className="w-40">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部候选人</SelectItem>
                <SelectItem value="high">高匹配度(≥70分)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mb-4">
            <span className="mb-2 block text-xs text-gray-400">
              支持多选文件或整个文件夹，也可直接拖入
            </span>
            <div
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-6 text-sm text-gray-500 transition-colors cursor-pointer ${
                dragging
                  ? 'border-blue-400 bg-blue-50/60'
                  : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/30'
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
              <FileUp className="h-6 w-6 mb-1 text-blue-500" />
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
                <span className="mx-1 text-gray-300">/</span>
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
                handleImportFiles(Array.from(event.target.files || []));
                event.target.value = '';
              }}
            />
            <input
              ref={folderInputRefCallback}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                handleImportFiles(Array.from(event.target.files || []));
                event.target.value = '';
              }}
            />
          </div>

          {selectedIds.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-2 text-sm">
              <span className="text-gray-700">
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

          {loading ? (
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
                      onClick={() => {
                        setSelectedCandidate(candidate);
                        setCandidateDetailOpen(true);
                      }}
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
                            <p className="font-medium text-gray-900">
                              {candidate.name}
                            </p>
                            <p className="max-w-40 truncate text-xs text-gray-500">
                              {candidate.current_position || '未知职位'}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-gray-700">
                          {candidate.current_company || '—'}
                        </p>
                        {sourceJob && (
                          <p className="max-w-48 truncate text-xs text-gray-400">
                            绑定：{sourceJob.title}
                            {candidate.source_job_binding_status ===
                              'expired' && (
                              <span className="text-amber-600">（已过期）</span>
                            )}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-gray-700">
                        {candidate.experience_years !== null &&
                        candidate.experience_years !== undefined
                          ? `${candidate.experience_years}年`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-gray-700">
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
                          <span className="text-gray-400">—</span>
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
                          <span className="text-gray-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-gray-400">
                        {candidate.created_by_name || '—'}
                      </TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <div className="flex">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`查看${candidate.name}详情`}
                            onClick={() => {
                              setSelectedCandidate(candidate);
                              setCandidateDetailOpen(true);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`撤回${candidate.name}授权`}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => {
                              setRevokeCandidate(candidate);
                              setRevokeConfirmOpen(true);
                            }}
                          >
                            <ShieldOff className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`删除${candidate.name}`}
                            title={
                              matchedCandidateIds.has(candidate.id)
                                ? '已有匹配/决策记录，为保留留痕请改用「撤回授权」'
                                : '删除候选人'
                            }
                            disabled={matchedCandidateIds.has(candidate.id)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
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
            <div className="text-center py-12 text-gray-500">
              <Users className="h-16 w-16 mx-auto mb-4 text-gray-300" />
              <p>
                {candidateSearch || candidateFilter !== 'all'
                  ? '未找到匹配的候选人'
                  : '暂无候选人，点击上方按钮添加'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <CandidateDetailDialog
        candidate={selectedCandidate}
        matchRecord={
          selectedCandidate
            ? matchRecords.find(
                (record) => record.candidate_id === selectedCandidate.id,
              ) ?? null
            : null
        }
        open={candidateDetailOpen}
        onOpenChange={setCandidateDetailOpen}
      />
      <RevokeCandidateDialog
        candidate={revokeCandidate}
        open={revokeConfirmOpen}
        onOpenChange={setRevokeConfirmOpen}
      />
      <Dialog open={batchRevokeOpen} onOpenChange={setBatchRevokeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>批量撤回授权</DialogTitle>
            <DialogDescription>
              确定要撤回所选 {selectedIds.size}
              位候选人的简历授权吗？撤回后将脱敏处理其个人信息，此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
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
              该候选人尚无匹配与决策记录，删除后数据不可恢复（含授权记录与简历文件）。
              如需保留匿名统计，请改用「撤回授权」。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
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
      <ImportPreviewDialog
        open={importPreviewOpen}
        onOpenChange={(open) => {
          setImportPreviewOpen(open);
          if (!open) setImportFiles([]);
        }}
        files={importFiles}
        onImported={reloadCandidates}
      />
      <CandidateFormDialog
        open={formDialogOpen}
        onOpenChange={handleFormDialogOpenChange}
        initialValues={formInitialValues}
        duplicates={formDuplicates}
        hideTrigger
      />
      <Dialog open={quickAddOpen} onOpenChange={setQuickAddOpen}>
        <DialogContent className="flex h-[90vh] max-h-[42rem] max-w-2xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>简历快捷入库</DialogTitle>
            <DialogDescription>
              粘贴从招聘平台复制的简历文本，AI
              将自动提取字段并预填入库表单；未启用 AI 时使用本地规则提取
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-2 py-2">
            <Textarea
              value={quickAddText}
              onChange={(event) => setQuickAddText(event.target.value)}
              placeholder="粘贴简历文本（姓名、联系方式、技能、工作经历等）..."
              className="min-h-0 flex-1 resize-none overflow-y-auto field-sizing-fixed"
            />
            <p className="shrink-0 text-xs text-gray-400">
              最多 20000 字符；提取后请核对字段并补充授权信息再保存
            </p>
          </div>
          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setQuickAddOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleQuickExtract}
              disabled={quickAddLoading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Wand2 className="h-4 w-4 mr-2" />
              {quickAddLoading ? '提取中...' : 'AI 提取'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
