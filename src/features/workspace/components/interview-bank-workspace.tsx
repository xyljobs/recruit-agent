'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { authFetch } from '@/lib/auth-client';
import { useWorkspaceData } from '../hooks/use-workspace-data';

interface BankQuestionRow {
  id: string;
  scope: 'organization' | 'job';
  job_id: string | null;
  dimension: string;
  question: string;
  probe_followups: string[];
  expected_signals: string[];
  scoring_anchors: string[];
  difficulty: '基础' | '进阶' | '高级' | null;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

interface BulkImportResult {
  created: number;
  skipped: number;
  errors: Array<{ line: number; message: string }>;
}

const DIFFICULTY_OPTIONS = ['基础', '进阶', '高级'] as const;

function linesToArray(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value));
}

const EMPTY_FORM = {
  scope: 'organization' as 'organization' | 'job',
  job_id: '',
  dimension: '',
  question: '',
  difficulty: '基础' as '基础' | '进阶' | '高级',
  expected_signals: '',
  probe_followups: '',
  scoring_anchors: '',
};

export function InterviewBankWorkspace() {
  const { jobs } = useWorkspaceData();
  const [rows, setRows] = useState<BankQuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scopeFilter, setScopeFilter] = useState<'all' | 'organization' | 'job'>('all');
  const [dimensionFilter, setDimensionFilter] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);
  const [editing, setEditing] = useState<BankQuestionRow | null>(null);
  const [editQuestion, setEditQuestion] = useState('');
  const [editDimension, setEditDimension] = useState('');
  const [editDifficulty, setEditDifficulty] = useState('');
  const [patching, setPatching] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch('/api/interview/bank');
      const result: { success?: boolean; data?: BankQuestionRow[]; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '面试题库加载失败');
      setRows(result.data ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '面试题库加载失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRows(); }, [loadRows]);

  const filteredRows = useMemo(() => {
    const dimension = dimensionFilter.trim().toLowerCase();
    return rows.filter(row => {
      if (scopeFilter !== 'all' && row.scope !== scopeFilter) return false;
      if (dimension && !row.dimension.toLowerCase().includes(dimension)) return false;
      return true;
    });
  }, [rows, scopeFilter, dimensionFilter]);

  function jobTitle(jobId: string | null): string {
    if (!jobId) return '组织级';
    return jobs.find(job => job.id === jobId)?.title ?? '职位级';
  }

  async function createSingle() {
    const dimension = form.dimension.trim();
    const question = form.question.trim();
    if (!dimension) { toast.error('请填写考察点'); return; }
    if (!question) { toast.error('请填写题目'); return; }
    if (form.scope === 'job' && !form.job_id) { toast.error('职位级题目必须选择职位'); return; }
    setCreating(true);
    try {
      const response = await authFetch('/api/interview/bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'single',
          scope: form.scope,
          job_id: form.scope === 'job' ? form.job_id : undefined,
          dimension,
          question,
          difficulty: form.difficulty,
          expected_signals: linesToArray(form.expected_signals).slice(0, 3),
          probe_followups: linesToArray(form.probe_followups).slice(0, 2),
          scoring_anchors: linesToArray(form.scoring_anchors).slice(0, 3),
        }),
      });
      const result: { success?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '题目新增失败');
      toast.success('题目已录入题库');
      setForm(EMPTY_FORM);
      await loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '题目新增失败');
    } finally {
      setCreating(false);
    }
  }

  async function importBulk() {
    if (!bulkText.trim()) { toast.error('请先粘贴要导入的题目'); return; }
    setImporting(true);
    setImportResult(null);
    try {
      const response = await authFetch('/api/interview/bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'bulk', bulk_text: bulkText }),
      });
      const result: { success?: boolean; data?: BulkImportResult; error?: string } = await response.json();
      if (!response.ok || !result.success || !result.data) throw new Error(result.error || '批量导入失败');
      setImportResult(result.data);
      toast.success(`批量导入完成：新增 ${result.data.created} 条`);
      if (result.data.created > 0) await loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '批量导入失败');
    } finally {
      setImporting(false);
    }
  }

  function openEdit(row: BankQuestionRow) {
    setEditing(row);
    setEditQuestion(row.question);
    setEditDimension(row.dimension);
    setEditDifficulty(row.difficulty ?? '基础');
  }

  async function saveEdit() {
    if (!editing) return;
    const question = editQuestion.trim();
    const dimension = editDimension.trim();
    if (!question) { toast.error('题目不能为空'); return; }
    if (!dimension) { toast.error('考察点不能为空'); return; }
    setPatching(true);
    try {
      const response = await authFetch(`/api/interview/bank/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, dimension, difficulty: editDifficulty }),
      });
      const result: { success?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '题目更新失败');
      toast.success('题目已更新');
      setEditing(null);
      await loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '题目更新失败');
    } finally {
      setPatching(false);
    }
  }

  async function toggleActive(row: BankQuestionRow) {
    setTogglingId(row.id);
    try {
      const response = await authFetch(`/api/interview/bank/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !row.is_active }),
      });
      const result: { success?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '题目状态更新失败');
      await loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '题目状态更新失败');
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Question bank</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">面试题库</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          维护组织级与职位级面试题。题库中的公共必问题在生成面试提纲时按原文拼入，不经 AI 改写；涉及禁问话题的题目会在录入时被拦截。
        </p>
      </div>

      <Card className="border-slate-200 shadow-none">
        <CardHeader>
          <CardTitle className="text-base">新增题目</CardTitle>
          <CardDescription>单条录入或批量粘贴导入。公共题只能人工录入，系统不会代为改写。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-4 rounded-lg border border-slate-200 p-4">
              <h4 className="text-sm font-semibold text-slate-900">单条新增</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="bank-scope">题目范围</Label>
                  <Select value={form.scope} onValueChange={(value) => setForm({ ...form, scope: value as 'organization' | 'job' })}>
                    <SelectTrigger id="bank-scope"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="organization">组织级（所有职位共用）</SelectItem>
                      <SelectItem value="job">职位级（指定职位）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.scope === 'job' && (
                  <div className="space-y-2">
                    <Label htmlFor="bank-job">目标职位</Label>
                    <Select value={form.job_id} onValueChange={(value) => setForm({ ...form, job_id: value })}>
                      <SelectTrigger id="bank-job"><SelectValue placeholder="选择职位" /></SelectTrigger>
                      <SelectContent>
                        {jobs.map(job => <SelectItem key={job.id} value={job.id}>{job.title}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="bank-dimension">考察点</Label>
                  <Input id="bank-dimension" value={form.dimension} onChange={(event) => setForm({ ...form, dimension: event.target.value })} placeholder="如：项目经验" maxLength={50} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bank-difficulty">难度</Label>
                  <Select value={form.difficulty} onValueChange={(value) => setForm({ ...form, difficulty: value as '基础' | '进阶' | '高级' })}>
                    <SelectTrigger id="bank-difficulty"><SelectValue /></SelectTrigger>
                    <SelectContent>{DIFFICULTY_OPTIONS.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank-question">题目原文</Label>
                <Textarea id="bank-question" value={form.question} onChange={(event) => setForm({ ...form, question: event.target.value })} placeholder="面试题目（禁止涉及婚姻、生育、年龄等话题）" className="min-h-16" maxLength={500} />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="bank-signals">期望信号（每行一条，≤3）</Label>
                  <Textarea id="bank-signals" value={form.expected_signals} onChange={(event) => setForm({ ...form, expected_signals: event.target.value })} placeholder="候选人的理想回答要点" className="min-h-16 text-xs" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bank-followups">追问路径（每行一条，≤2）</Label>
                  <Textarea id="bank-followups" value={form.probe_followups} onChange={(event) => setForm({ ...form, probe_followups: event.target.value })} placeholder="追问方向" className="min-h-16 text-xs" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bank-anchors">打分锚点（每行一条，≤3）</Label>
                  <Textarea id="bank-anchors" value={form.scoring_anchors} onChange={(event) => setForm({ ...form, scoring_anchors: event.target.value })} placeholder="好/中/差分档描述" className="min-h-16 text-xs" />
                </div>
              </div>
              <Button onClick={() => void createSingle()} disabled={creating}><Plus className="mr-2 h-4 w-4" />{creating ? '录入中…' : '录入题库'}</Button>
            </div>

            <div className="space-y-4 rounded-lg border border-slate-200 p-4">
              <h4 className="text-sm font-semibold text-slate-900">批量粘贴导入</h4>
              <div className="space-y-2">
                <Label htmlFor="bank-bulk">每行一条题目</Label>
                <Textarea id="bank-bulk" value={bulkText} onChange={(event) => setBulkText(event.target.value)} placeholder={'格式：题目 | 考察点 | 期望信号（多条用；分隔）\n\n请描述你主导过的最复杂项目及你的角色 | 项目经验 | 主导角色；量化结果\n你如何与跨部门团队协作解决冲突 | 协作能力 | 冲突处理实例'} className="min-h-32 font-mono text-xs" />
              </div>
              <p className="text-xs leading-5 text-slate-500">
                <Info className="mr-1 inline h-3.5 w-3.5" />
                用 <code className="rounded bg-slate-100 px-1">|</code> 或全角 <code className="rounded bg-slate-100 px-1">｜</code> 分隔；考察点必填，期望信号可选。错误行会被跳过并单独反馈，不影响其余行导入。导入的题目均为组织级。
              </p>
              <Button onClick={() => void importBulk()} disabled={importing}><Upload className="mr-2 h-4 w-4" />{importing ? '导入中…' : '批量导入'}</Button>
              {importResult && (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="font-medium text-slate-900">导入结果：新增 {importResult.created} 条，跳过重复 {importResult.skipped} 条</p>
                  {importResult.errors.length > 0 && (
                    <ul className="max-h-40 space-y-1 overflow-y-auto pl-1 text-xs leading-5 text-red-700">
                      {importResult.errors.map((error, index) => (
                        <li key={`${error.line}-${index}`} className="flex gap-1"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />第 {error.line} 行：{error.message}</li>
                      ))}
                    </ul>
                  )}
                  {importResult.errors.length === 0 && <p className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />全部行导入成功</p>}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-none">
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">题库列表</CardTitle>
            <CardDescription className="mt-1">共 {rows.length} 条题目；停用后不再出现在生成提纲的公共必问题中。</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input value={dimensionFilter} onChange={(event) => setDimensionFilter(event.target.value)} placeholder="按考察点筛选" className="h-9 w-44 pl-8" />
            </div>
            <Select value={scopeFilter} onValueChange={(value) => setScopeFilter(value as 'all' | 'organization' | 'job')}>
              <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部范围</SelectItem>
                <SelectItem value="organization">组织级</SelectItem>
                <SelectItem value="job">职位级</SelectItem>
              </SelectContent>
            </Select>
            <Button size="icon" onClick={() => void loadRows()} disabled={loading} aria-label="刷新题库" title="刷新题库"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3"><Skeleton className="h-16 rounded-lg" /><Skeleton className="h-16 rounded-lg" /><Skeleton className="h-16 rounded-lg" /></div>
          ) : filteredRows.length === 0 ? (
            <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>暂无题目</AlertTitle><AlertDescription>在上方录入或批量导入题目，构建你的面试题库。</AlertDescription></Alert>
          ) : (
            <div className="space-y-3">
              {filteredRows.map(row => (
                <div key={row.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{row.scope === 'organization' ? '组织级' : '职位级'}</Badge>
                        <Badge variant="secondary">{row.dimension}</Badge>
                        {row.difficulty && <Badge variant="outline">{row.difficulty}</Badge>}
                        <span className="text-xs text-slate-400">v{row.version} · {jobTitle(row.job_id)} · 更新于 {formatDate(row.updated_at)}</span>
                      </div>
                      <p className={`mt-2 text-sm leading-6 ${row.is_active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{row.question}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Switch id={`active-${row.id}`} checked={row.is_active} disabled={togglingId === row.id} onCheckedChange={() => void toggleActive(row)} aria-label={row.is_active ? '停用该题目' : '启用该题目'} />
                        <Label htmlFor={`active-${row.id}`} className="text-xs text-slate-500">{row.is_active ? '启用' : '停用'}</Label>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(row)} aria-label="编辑题目" title="编辑题目"><Pencil className="h-4 w-4" /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑题目</DialogTitle>
            <DialogDescription>修改题目原文会使版本号 +1，历史提纲不受影响。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-dimension">考察点</Label>
              <Input id="edit-dimension" value={editDimension} onChange={(event) => setEditDimension(event.target.value)} maxLength={50} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-question">题目原文</Label>
              <Textarea id="edit-question" value={editQuestion} onChange={(event) => setEditQuestion(event.target.value)} className="min-h-24" maxLength={500} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-difficulty">难度</Label>
              <Select value={editDifficulty} onValueChange={(value) => setEditDifficulty(value as '基础' | '进阶' | '高级')}>
                <SelectTrigger id="edit-difficulty"><SelectValue /></SelectTrigger>
                <SelectContent>{DIFFICULTY_OPTIONS.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={() => void saveEdit()} disabled={patching}>{patching ? '保存中…' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
