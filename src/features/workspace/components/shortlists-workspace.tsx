'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Check,
  ChevronDown,
  CircleHelp,
  FileWarning,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { authFetch } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import type { ShortlistDecision, ShortlistEntry, ShortlistRun } from '../decision-types';
import { useWorkspaceData } from '../hooks/use-workspace-data';
import { normalizeShortlistRuns } from '../lib/decision-ui';

const DECISION_LABELS: Record<ShortlistDecision, string> = {
  unreviewed: '待人工判断',
  accepted: '已接受',
  needs_information: '需补充信息',
  overridden: '已人工覆盖',
};

const REASON_OPTIONS = [
  ['missing_context', '缺少业务背景'],
  ['business_constraint', '业务约束'],
  ['incorrect_evidence', '证据不准确'],
  ['stale_data', '数据已过期'],
  ['candidate_preference', '候选人意愿'],
  ['other', '其他'],
] as const;

interface PreparedCommunicationBrief {
  draft_message: string;
  candidate_value_points: string[];
  facts_to_verify: string[];
  interview_questions: string[];
  prohibited_claims: string[];
  review_status?: string;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function confidenceTone(score: number): string {
  if (score >= 75) return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (score >= 50) return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-red-200 bg-red-50 text-red-800';
}

function EvidenceList({ entry }: { entry: ShortlistEntry }) {
  if (entry.evidence_snapshot.length === 0) {
    return <p className="text-sm text-slate-500">当前没有足够证据，请先补充候选人或职位信息。</p>;
  }
  return (
    <div className="space-y-3">
      {entry.evidence_snapshot.map((evidence, index) => (
        <div key={`${evidence.criterion_id}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{evidence.dimension}</Badge>
            <Badge className={cn('hover:bg-current/0', evidence.support_level === 'supported' ? 'bg-emerald-100 text-emerald-800' : evidence.support_level === 'conflicting' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800')}>
              {evidence.support_level === 'supported' ? '有证据' : evidence.support_level === 'partial' ? '部分支持' : evidence.support_level === 'conflicting' ? '信息冲突' : '缺少证据'}
            </Badge>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-800">{evidence.finding}</p>
          {(evidence.candidate_excerpt || evidence.job_excerpt) && (
            <div className="mt-2 border-l-2 border-blue-200 pl-3 text-xs leading-5 text-slate-500">
              {evidence.candidate_excerpt && <p>候选人：{evidence.candidate_excerpt}</p>}
              {evidence.job_excerpt && <p>职位标准：{evidence.job_excerpt}</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ShortlistEntryCard({ entry, onChanged }: { entry: ShortlistEntry; onChanged: () => Promise<void> }) {
  const [decision, setDecision] = useState<Exclude<ShortlistDecision, 'unreviewed'>>(
    entry.human_decision === 'unreviewed' ? 'accepted' : entry.human_decision,
  );
  const [reasonCode, setReasonCode] = useState(entry.override_reason_code ?? '');
  const [note, setNote] = useState(entry.override_note ?? '');
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [brief, setBrief] = useState<PreparedCommunicationBrief | null>(null);

  async function saveDecision() {
    if (decision === 'overridden' && !reasonCode) {
      toast.error('覆盖推荐时必须选择原因');
      return;
    }
    if (decision === 'overridden' && reasonCode === 'other' && !note.trim()) {
      toast.error('选择“其他”时请填写说明');
      return;
    }
    setSaving(true);
    try {
      const response = await authFetch(`/api/shortlists/${entry.shortlist_run_id}/entries/${entry.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          reason_code: decision === 'overridden' ? reasonCode : null,
          note: note.trim() || null,
          client_event_id: crypto.randomUUID(),
          occurred_at: new Date().toISOString(),
        }),
      });
      const result: { success?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存人工决策失败');
      toast.success('人工决策已记录');
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存人工决策失败');
    } finally {
      setSaving(false);
    }
  }

  async function prepareCommunication() {
    setPreparing(true);
    try {
      const response = await authFetch('/api/script/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortlist_entry_id: entry.id, communication_goal: '邀请候选人了解职位机会' }),
      });
      const result: { success?: boolean; data?: { script?: string; brief?: PreparedCommunicationBrief }; error?: string } = await response.json();
      if (!response.ok || !result.success || !result.data?.script || !result.data.brief) throw new Error(result.error || '沟通内容准备失败');
      setBrief(result.data.brief);
      toast.success('沟通内容已准备，请人工确认后使用');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '沟通内容准备失败');
    } finally {
      setPreparing(false);
    }
  }

  const candidateName = entry.candidate?.name || `候选人 ${entry.rank}`;
  const authorization = entry.candidate?.authorization;

  return (
    <Card className="gap-0 overflow-hidden border-slate-200 py-0 shadow-none">
      <div className="grid border-b border-slate-200 lg:grid-cols-[6rem_1fr_auto]">
        <div className="flex items-center justify-center bg-slate-950 px-4 py-5 text-white">
          <div className="text-center"><span className="block text-xs text-slate-400">优先序</span><strong className="mt-1 block text-3xl">{entry.rank}</strong></div>
        </div>
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="text-lg font-semibold text-slate-950">{candidateName}</h3><p className="mt-1 text-sm text-slate-500">{[entry.candidate?.current_position, entry.candidate?.current_company].filter(Boolean).join(' · ') || '职位信息待补充'}</p></div>
            <Badge variant="outline" className={confidenceTone(entry.confidence_score)}>证据置信度 {entry.confidence_score}%</Badge>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary"><ShieldCheck className="mr-1 h-3 w-3" />来源：{authorization?.source_type || '当前视图未披露'}</Badge>
            <Badge variant="secondary">授权状态：{authorization?.is_active === false ? '不可处理' : authorization?.evidence_status || '入选前已由服务端复核'}</Badge>
            <Badge variant="secondary">处理期限：{formatDate(authorization?.processing_expires_at)}</Badge>
          </div>
        </div>
        <div className="flex items-center border-t border-slate-200 px-5 py-4 lg:border-l lg:border-t-0">
          <div><span className="text-xs text-slate-500">当前人工结论</span><p className="mt-1 font-medium text-slate-900">{DECISION_LABELS[entry.human_decision]}</p></div>
        </div>
      </div>

      <CardContent className="grid gap-6 py-6 lg:grid-cols-[1.3fr_.7fr]">
        <section aria-labelledby={`evidence-${entry.id}`}>
          <h4 id={`evidence-${entry.id}`} className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><Sparkles className="h-4 w-4 text-blue-600" />匹配证据</h4>
          <EvidenceList entry={entry} />
        </section>
        <aside className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-amber-950"><FileWarning className="h-4 w-4" />缺失信息</h4>
            {entry.missing_information.length > 0 ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-5 text-amber-900">{entry.missing_information.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="mt-2 text-sm text-amber-800">未发现关键缺失项</p>}
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <h4 className="text-sm font-semibold text-slate-900">证据完整度</h4>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" aria-label={`置信度 ${entry.confidence_score}%`}><div className="h-full bg-blue-600" style={{ width: `${entry.confidence_score}%` }} /></div>
            <p className="mt-2 text-xs leading-5 text-slate-500">置信度只表示证据是否充分，不代表候选人质量。</p>
          </div>
        </aside>
      </CardContent>

      <div className="border-t border-slate-200 bg-slate-50 p-5">
        <div className="grid gap-3 lg:grid-cols-[12rem_13rem_1fr_auto] lg:items-end">
          <div className="space-y-2">
            <Label htmlFor={`decision-${entry.id}`}>人工决策</Label>
            <Select value={decision} onValueChange={(value) => setDecision(value as Exclude<ShortlistDecision, 'unreviewed'>)}>
              <SelectTrigger id={`decision-${entry.id}`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="accepted">接受推荐</SelectItem><SelectItem value="needs_information">补充信息</SelectItem><SelectItem value="overridden">覆盖推荐</SelectItem></SelectContent>
            </Select>
          </div>
          {decision === 'overridden' && (
            <div className="space-y-2">
              <Label htmlFor={`reason-${entry.id}`}>覆盖原因（必填）</Label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger id={`reason-${entry.id}`} className="w-full"><SelectValue placeholder="选择原因" /></SelectTrigger>
                <SelectContent>{REASON_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor={`note-${entry.id}`}>{decision === 'needs_information' ? '需要补充什么' : '决策说明'}</Label>
            <Textarea id={`note-${entry.id}`} value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录可追溯的人工判断依据" className="min-h-9 resize-y" />
          </div>
          <Button onClick={() => void saveDecision()} disabled={saving}>{decision === 'accepted' ? <Check className="mr-2 h-4 w-4" /> : decision === 'overridden' ? <X className="mr-2 h-4 w-4" /> : <CircleHelp className="mr-2 h-4 w-4" />}{saving ? '保存中…' : '记录决策'}</Button>
        </div>
        {entry.human_decision === 'accepted' && (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <Button variant="outline" onClick={() => void prepareCommunication()} disabled={preparing}><MessageSquareText className="mr-2 h-4 w-4" />{preparing ? '准备中…' : '准备沟通内容'}</Button>
            <p className="mt-2 text-xs text-slate-500">仅已被人工接受的候选人可准备沟通；发送前仍需人工确认。</p>
            {brief && (
              <div className="mt-3 grid gap-4 rounded-lg border border-blue-200 bg-white p-4 lg:grid-cols-2">
                <div className="lg:col-span-2">
                  <div className="flex items-center justify-between gap-3"><h5 className="text-sm font-semibold text-slate-900">待人工审核的沟通草稿</h5><Badge variant="outline">{brief.review_status === 'approved' ? '已审核' : '待审核'}</Badge></div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{brief.draft_message}</p>
                </div>
                <div><h5 className="text-sm font-semibold text-slate-900">可用沟通切入点</h5><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{brief.candidate_value_points.map(item => <li key={item}>{item}</li>)}</ul></div>
                <div><h5 className="text-sm font-semibold text-slate-900">发送前需核验</h5><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{brief.facts_to_verify.map(item => <li key={item}>{item}</li>)}</ul></div>
                <div><h5 className="text-sm font-semibold text-slate-900">建议面试问题</h5><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{brief.interview_questions.map(item => <li key={item}>{item}</li>)}</ul></div>
                <div><h5 className="text-sm font-semibold text-slate-900">禁止承诺</h5><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{brief.prohibited_claims.map(item => <li key={item}>{item}</li>)}</ul></div>
              </div>
            )}
          </div>
        )}
      </div>

      <Collapsible>
        <CollapsibleTrigger asChild><Button variant="ghost" className="w-full rounded-none border-t border-slate-200 text-slate-600"><ChevronDown className="mr-2 h-4 w-4" />查看排序分数明细（仅供参考）</Button></CollapsibleTrigger>
        <CollapsibleContent className="border-t border-slate-200 p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-slate-500">综合排序分</span><p className="mt-1 text-lg font-semibold">{entry.overall_score ?? '—'}</p></div>
            {Object.entries(entry.score_breakdown ?? {}).map(([key, value]) => <div key={key} className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-slate-500">{key}</span><p className="mt-1 text-lg font-semibold">{value ?? '—'}</p></div>)}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export function ShortlistsWorkspace() {
  const { jobs } = useWorkspaceData();
  const [runs, setRuns] = useState<ShortlistRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [loading, setLoading] = useState(true);
  const [qualifying, setQualifying] = useState(false);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch('/api/shortlists');
      const result: { success?: boolean; data?: unknown; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '短名单加载失败');
      const nextRuns = normalizeShortlistRuns(result.data);
      setRuns(nextRuns);
      setSelectedRunId((current) => current && nextRuns.some((run) => run.id === current) ? current : nextRuns[0]?.id || '');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '短名单加载失败');
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRuns(); }, [loadRuns]);
  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) ?? null, [runs, selectedRunId]);
  const reviewedCount = selectedRun?.entries.filter((entry) => entry.human_decision !== 'unreviewed').length ?? 0;
  const acceptedCount = selectedRun?.entries.filter((entry) => entry.human_decision === 'accepted').length ?? 0;

  function jobTitle(run: ShortlistRun): string {
    return run.job?.title || jobs.find((job) => job.id === run.job_id)?.title || run.job_id;
  }

  async function qualifyRun() {
    if (!selectedRun) return;
    setQualifying(true);
    try {
      const response = await authFetch(`/api/shortlists/${selectedRun.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_event_id: crypto.randomUUID() }),
      });
      const result: { success?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '确认合格短名单失败');
      toast.success('已确认首份合格短名单');
      await loadRuns();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '确认合格短名单失败');
    } finally {
      setQualifying(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Human review</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">候选人短名单</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">先审证据和缺失信息，再做人工判断。排序分隐藏在明细中，不能用于自动拒绝。</p></div>
        <Button variant="outline" onClick={() => void loadRuns()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新短名单</Button>
      </div>

      {loading ? <div className="space-y-4"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-96 rounded-xl" /></div> : runs.length === 0 ? (
        <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>还没有短名单</AlertTitle><AlertDescription>请先在<Link href="/jobs" className="mx-1 font-medium text-blue-700 underline underline-offset-4">职位与标准</Link>中确认职位，再发起短名单生成。</AlertDescription></Alert>
      ) : (
        <>
          <Card className="gap-4 border-slate-200 shadow-none">
            <CardContent className="grid gap-4 pt-0 md:grid-cols-[1fr_auto] md:items-end">
              <div className="space-y-2"><Label htmlFor="shortlist-run">职位与短名单批次</Label><Select value={selectedRunId} onValueChange={setSelectedRunId}><SelectTrigger id="shortlist-run" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{runs.map((run) => <SelectItem key={run.id} value={run.id}>{jobTitle(run)} · {formatDate(run.requested_at)}</SelectItem>)}</SelectContent></Select></div>
              <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{selectedRun?.candidate_count ?? 0} 位候选人</Badge><Badge variant="outline">已审 {reviewedCount}/{selectedRun?.entries.length ?? 0}</Badge>{selectedRun?.qualified_at ? <Badge className="bg-emerald-100 text-emerald-800"><UserCheck className="mr-1 h-3 w-3" />HR 已确认合格</Badge> : <Button size="sm" onClick={() => void qualifyRun()} disabled={qualifying || acceptedCount === 0}><UserCheck className="mr-2 h-4 w-4" />{qualifying ? '确认中…' : '确认合格短名单'}</Button>}</div>
            </CardContent>
          </Card>
          {selectedRun?.entries.length ? <div className="space-y-5">{[...selectedRun.entries].sort((left, right) => left.rank - right.rank).map((entry) => <ShortlistEntryCard key={entry.id} entry={entry} onChanged={loadRuns} />)}</div> : <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>短名单正在准备</AlertTitle><AlertDescription>当前批次尚无可审阅条目，请稍后刷新。</AlertDescription></Alert>}
        </>
      )}
    </div>
  );
}
