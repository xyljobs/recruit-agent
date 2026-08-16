'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  FileWarning,
  Loader2,
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
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { authFetch } from '@/lib/auth-client';
import { formatExperienceBand } from '@/lib/matching/screening-rubric';
import { collectHardConstraints, deriveMatchVerdict } from '@/lib/matching/verdict';
import { cn } from '@/lib/utils';
import { DECISION_LABELS } from '../constants';
import type { ShortlistDecision, ShortlistEntry, ShortlistRun } from '../decision-types';
import { useWorkspaceData } from '../hooks/use-workspace-data';
import { normalizeShortlistRuns } from '../lib/decision-ui';
import type { Candidate, MatchRecord } from '../types';
import { CandidateDetailPanel } from './candidate-dialogs';
import { MatchRankingTable } from './match-ranking-table';

const REASON_OPTIONS = [
  ['missing_context', '缺少业务背景'],
  ['business_constraint', '业务约束'],
  ['incorrect_evidence', '证据不准确'],
  ['stale_data', '数据已过期'],
  ['candidate_preference', '候选人意愿'],
  ['other', '其他'],
] as const;

const SHORTLIST_POLL_INTERVAL_MS = 2000;
const SHORTLIST_PENDING_STALL_SECONDS = 60;
const SHORTLIST_TOTAL_TIMEOUT_SECONDS = 600;

type ShortlistStage = 'reading_job' | 'loading_candidates' | 'scoring' | 'generating_shortlist';

const SHORTLIST_STAGES: Array<{ stage: ShortlistStage; label: string }> = [
  { stage: 'reading_job', label: '读取职位标准与评分权重' },
  { stage: 'loading_candidates', label: '筛选具备决策权的候选人' },
  { stage: 'scoring', label: '计算候选人匹配评分' },
  { stage: 'generating_shortlist', label: '排序并生成短名单' },
];

interface ShortlistProgress {
  status: 'pending' | 'running';
  elapsed: number;
  stalled: boolean;
  stage: ShortlistStage | null;
  scoredCandidates: number;
  totalCandidates: number;
}

function parseShortlistStage(rawProgress: unknown): {
  stage: ShortlistStage | null;
  scoredCandidates: number;
  totalCandidates: number;
} {
  if (!rawProgress || typeof rawProgress !== 'object') {
    return { stage: null, scoredCandidates: 0, totalCandidates: 0 };
  }
  const progress = rawProgress as {
    stage?: unknown;
    scored_candidates?: unknown;
    total_candidates?: unknown;
  };
  const stage = typeof progress.stage === 'string'
    && SHORTLIST_STAGES.some((item) => item.stage === progress.stage)
    ? progress.stage as ShortlistStage
    : null;
  const scoredCandidates = typeof progress.scored_candidates === 'number'
    ? progress.scored_candidates
    : 0;
  const totalCandidates = typeof progress.total_candidates === 'number'
    ? progress.total_candidates
    : 0;
  return { stage, scoredCandidates, totalCandidates };
}

function shortlistStageIndex(stage: ShortlistStage | null): number {
  if (!stage) return -1;
  return SHORTLIST_STAGES.findIndex((item) => item.stage === stage);
}

function shortlistProgressValue(progress: ShortlistProgress): number {
  if (progress.status === 'pending') return 12;
  switch (progress.stage) {
    case 'reading_job': return 30;
    case 'loading_candidates': return 50;
    case 'scoring':
      if (progress.totalCandidates > 0) {
        const ratio = Math.min(progress.scoredCandidates / progress.totalCandidates, 1);
        return 50 + Math.round(ratio * 35);
      }
      return 55;
    case 'generating_shortlist': return 90;
    default: return 40;
  }
}

interface PreparedCommunicationBrief {
  draft_message: string;
  candidate_value_points: string[];
  facts_to_verify: string[];
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
        <div key={`${evidence.criterion_id}-${index}`} className="rounded-lg border border-slate-200 bg-card p-3">
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
  const router = useRouter();
  const [decision, setDecision] = useState<Exclude<ShortlistDecision, 'unreviewed'>>(
    entry.human_decision === 'unreviewed' ? 'accepted' : entry.human_decision,
  );
  const [reasonCode, setReasonCode] = useState(entry.override_reason_code ?? '');
  const [note, setNote] = useState(entry.override_note ?? '');
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [communicationSteps, setCommunicationSteps] = useState<string[]>([]);
  const [brief, setBrief] = useState<PreparedCommunicationBrief | null>(null);

  const verdict = useMemo(() => {
    const skillAnalysis = entry.match_details?.skill_analysis;
    const matched = skillAnalysis?.matched ?? [];
    const missing = skillAnalysis?.missing ?? [];
    return deriveMatchVerdict({
      overall_score: entry.overall_score ?? null,
      confidence_score: entry.confidence_score,
      required_skill_total: matched.length + missing.length,
      required_skill_matched: matched.length,
      hard_constraints: collectHardConstraints({
        authorization_is_active: entry.candidate?.authorization?.is_active,
        processing_expires_at: entry.candidate?.authorization?.processing_expires_at,
        automated_decision_objected_at: entry.candidate?.authorization?.automated_decision_objected_at,
        skill_matched: matched,
        skill_missing: missing,
      }),
      boundary_flags: [],
    });
  }, [entry]);

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
    setCommunicationSteps(['正在准备候选人信息与匹配证据…']);
    try {
      const response = await authFetch('/api/script/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortlist_entry_id: entry.id, communication_goal: '邀请候选人了解职位机会' }),
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok) {
        const result: { error?: string } | null = await response.json().catch(() => null);
        throw new Error(result?.error || '话术生成失败');
      }
      // JSON 响应：rules_only 模式本地规则即时返回
      if (contentType.includes('application/json')) {
        const result: { success?: boolean; data?: { script?: string; brief?: PreparedCommunicationBrief }; error?: string } = await response.json();
        if (!result.success || !result.data?.script || !result.data.brief) throw new Error(result.error || '话术生成失败');
        setBrief(result.data.brief);
        toast.success('AI 话术已生成，请人工确认后使用');
        return;
      }
      // NDJSON 流式：status 为生成过程，done 携带最终结果
      const reader = response.body?.getReader();
      if (!reader) throw new Error('话术生成失败');
      const decoder = new TextDecoder();
      let buffer = '';
      const outcome: { brief?: PreparedCommunicationBrief; error?: string } = {};
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const event: { type?: string; text?: string; data?: { script?: string; brief?: PreparedCommunicationBrief }; error?: string } = JSON.parse(line);
        if (event.type === 'status' && event.text) {
          setCommunicationSteps((prev) => [...prev, event.text as string]);
        } else if (event.type === 'done' && event.data) {
          outcome.brief = event.data.brief;
        } else if (event.type === 'error') {
          outcome.error = event.error || '话术生成失败';
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(handleLine);
      }
      handleLine(buffer);
      if (outcome.error) throw new Error(outcome.error);
      if (!outcome.brief) throw new Error('话术生成失败');
      setBrief(outcome.brief);
      toast.success('AI 话术已生成，请人工确认后使用');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '话术生成失败');
    } finally {
      setPreparing(false);
      setCommunicationSteps([]);
    }
  }

  function openInterviewGuide() {
    router.push(`/interview-guides?entry=${entry.id}`);
  }

  const candidateName = entry.candidate?.name || `候选人 ${entry.rank}`;
  const authorization = entry.candidate?.authorization;

  return (
    <Card id={`entry-card-${entry.id}`} className="gap-0 overflow-hidden border-slate-200 py-0 shadow-none">
      <div className="grid border-b border-slate-200 lg:grid-cols-[6rem_1fr_auto]">
        <div className="flex items-center justify-center bg-slate-950 px-4 py-5 text-white">
          <div className="text-center"><span className="block text-xs text-slate-400">优先序</span><strong className="mt-1 block text-3xl">{entry.rank}</strong></div>
        </div>
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-slate-950">{candidateName}</h3>
                <Badge variant="outline" className={verdict.tone}>{verdict.label}</Badge>
                {entry.human_decision === 'overridden' && <Badge className="bg-violet-100 text-violet-800">已人工覆盖</Badge>}
              </div>
              <p className="mt-1 text-sm text-slate-500">{[entry.candidate?.current_position, entry.candidate?.current_company].filter(Boolean).join(' · ') || '职位信息待补充'}</p>
            </div>
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
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" aria-label={`置信度 ${entry.confidence_score}%`}><div className="h-full bg-primary" style={{ width: `${entry.confidence_score}%` }} /></div>
            <p className="mt-2 text-xs leading-5 text-slate-500">置信度只表示证据是否充分，不代表候选人质量。</p>
          </div>
        </aside>
      </CardContent>

      <div className="border-t border-slate-200 bg-slate-50 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44 space-y-2">
            <Label htmlFor={`decision-${entry.id}`}>人工决策</Label>
            <Select value={decision} onValueChange={(value) => setDecision(value as Exclude<ShortlistDecision, 'unreviewed'>)}>
              <SelectTrigger id={`decision-${entry.id}`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="accepted">接受推荐</SelectItem><SelectItem value="needs_information">补充信息</SelectItem><SelectItem value="overridden">覆盖推荐</SelectItem></SelectContent>
            </Select>
          </div>
          {decision === 'overridden' && (
            <div className="w-44 space-y-2">
              <Label htmlFor={`reason-${entry.id}`}>覆盖原因（必填）</Label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger id={`reason-${entry.id}`} className="w-full"><SelectValue placeholder="选择原因" /></SelectTrigger>
                <SelectContent>{REASON_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="min-w-44 flex-1 space-y-2">
            <Label htmlFor={`note-${entry.id}`}>{decision === 'needs_information' ? '需要补充什么' : '决策说明'}</Label>
            <Textarea id={`note-${entry.id}`} value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录可追溯的人工判断依据" className="min-h-9 resize-y" />
          </div>
          <Button onClick={() => void saveDecision()} disabled={saving}>{decision === 'accepted' ? <Check className="mr-2 h-4 w-4" /> : decision === 'overridden' ? <X className="mr-2 h-4 w-4" /> : <CircleHelp className="mr-2 h-4 w-4" />}{saving ? '保存中…' : '记录决策'}</Button>
        </div>
        {(entry.human_decision === 'accepted' || entry.human_decision === 'overridden') && (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              {entry.human_decision === 'accepted' && (
                <Button onClick={() => void prepareCommunication()} disabled={preparing}><MessageSquareText className="mr-2 h-4 w-4" />{preparing ? '生成中…' : 'AI生成话术'}</Button>
              )}
              <Button onClick={openInterviewGuide}><ClipboardList className="mr-2 h-4 w-4" />AI生成面试提纲</Button>
            </div>
            <p className="mt-2 text-xs text-slate-500">生成内容需人工确认后使用。</p>
            {preparing && (
              <div className="mt-3 rounded-lg bg-muted/50 p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">AI 正在生成沟通话术，请稍候：</p>
                <ul className="space-y-1.5">
                  {communicationSteps.map((step, index) => {
                    const isCurrent = index === communicationSteps.length - 1;
                    return (
                      <li key={`${step}-${index}`} className="flex items-center gap-2 text-xs text-muted-foreground">
                        {isCurrent ? <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" /> : <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                        {step}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {brief && (
              <div className="mt-3 grid gap-4 rounded-lg border border-blue-200 bg-card p-4 lg:grid-cols-2">
                <div className="lg:col-span-2">
                  <div className="flex items-center justify-between gap-3"><h5 className="text-sm font-semibold text-slate-900">待人工审核的沟通草稿</h5><Badge variant="outline">{brief.review_status === 'approved' ? '已审核' : '待审核'}</Badge></div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{brief.draft_message}</p>
                </div>
                <div><h5 className="text-sm font-semibold text-slate-900">可用沟通切入点</h5><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{brief.candidate_value_points.map(item => <li key={item}>{item}</li>)}</ul></div>
                <div><h5 className="text-sm font-semibold text-slate-900">发送前需核验</h5><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{brief.facts_to_verify.map(item => <li key={item}>{item}</li>)}</ul></div>
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

function ShortlistConceptGuide() {
  return (
    <Collapsible defaultOpen={false} className="rounded-xl border border-blue-200 bg-blue-50/60">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-start px-4 text-primary hover:bg-primary/10 hover:text-primary">
          <CircleHelp className="mr-2 h-4 w-4" />什么是短名单？首次使用先看这里
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4">
        <div className="grid gap-4 pt-2 lg:grid-cols-3">
          <div className="rounded-lg border border-blue-100 bg-card p-4">
            <h4 className="text-sm font-semibold text-slate-900">短名单是什么</h4>
            <p className="mt-2 text-sm leading-6 text-slate-600">短名单是系统针对某个职位，从候选人库中筛选出的「值得人工重点评估的一小批候选人」，按优先序排列。它不是最终录用决定，只是帮你把注意力集中在最可能合适的少数人身上。</p>
          </div>
          <div className="rounded-lg border border-blue-100 bg-card p-4">
            <h4 className="text-sm font-semibold text-slate-900">短名单从哪来</h4>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-600">
              <li>在<Link href="/jobs" className="mx-0.5 font-medium text-blue-700 underline underline-offset-4">职位与标准</Link>中解析 JD、确认用人标准；</li>
              <li>在<Link href="/candidates" className="mx-0.5 font-medium text-blue-700 underline underline-offset-4">候选人库</Link>中完成简历入库，并关联应聘职位；</li>
              <li>在本页选择职位，系统才会对已入库且仍绑定该职位的候选人进行智能匹配并生成短名单。</li>
            </ol>
          </div>
          <div className="rounded-lg border border-blue-100 bg-card p-4">
            <h4 className="text-sm font-semibold text-slate-900">在这里要做什么</h4>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-600">
              <li>在「排序表」横向比较全批次候选人的结论与依据，点候选人姓名查看画像；</li>
              <li>查看每位候选人的匹配证据与缺失信息；</li>
              <li>记录人工决策：接受推荐 / 补充信息 / 覆盖推荐（均会留痕）；</li>
              <li>对已接受的候选人生成沟通话术，确认后再触达；</li>
              <li>全部审阅后点「确认合格短名单」完成本轮人工审查。</li>
            </ol>
            <p className="mt-2 text-xs leading-5 text-slate-500">排序分仅供查阅，系统不会用它自动拒绝任何候选人，最终决定权始终在人。</p>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ShortlistsWorkspace() {
  const { jobs, candidates, matchRecords } = useWorkspaceData();
  const router = useRouter();
  const [runs, setRuns] = useState<ShortlistRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedJobId, setSelectedJobId] = useState('');
  const [loading, setLoading] = useState(true);
  const [creatingShortlist, setCreatingShortlist] = useState(false);
  const [qualifying, setQualifying] = useState(false);
  const [viewMode, setViewMode] = useState<string>('table');
  // 已打开的候选人详情 Tab：每点一个候选人新开一个可关闭的 Tab（用候选 ID 作 Tab value）
  const [openProfileIds, setOpenProfileIds] = useState<string[]>([]);
  const [progress, setProgress] = useState<ShortlistProgress | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressStartedAtRef = useRef(0);

  // 卸载时清理进度轮询定时器
  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

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
  const activeJobs = useMemo(
    () => jobs.filter((job) => job.status === 'active'),
    [jobs],
  );
  const selectedJob = useMemo(
    () => activeJobs.find((job) => job.id === selectedJobId) ?? null,
    [activeJobs, selectedJobId],
  );
  const boundCandidates = useMemo(
    () => candidates.filter(
      (candidate) => candidate.source_job_id === selectedJobId
        && candidate.source_job_binding_status === 'active',
    ),
    [candidates, selectedJobId],
  );

  useEffect(() => {
    setSelectedJobId((current) => (
      current && activeJobs.some((job) => job.id === current)
        ? current
        : activeJobs[0]?.id ?? ''
    ));
  }, [activeJobs]);

  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) ?? null, [runs, selectedRunId]);
  const reviewedCount = selectedRun?.entries.filter((entry) => entry.human_decision !== 'unreviewed').length ?? 0;
  const acceptedCount = selectedRun?.entries.filter((entry) => entry.human_decision === 'accepted').length ?? 0;

  // 详情 Tab 展示的候选人：优先取全局候选人库，缺失时用短名单条目快照兜底构造最小画像
  function resolveProfileCandidate(candidateId: string): Candidate | null {
    const direct = candidates.find((candidate) => candidate.id === candidateId);
    if (direct) return direct;
    const entry = selectedRun?.entries.find((item) => item.candidate_id === candidateId);
    if (!entry) return null;
    return {
      id: entry.candidate_id,
      name: entry.candidate?.name ?? '候选人',
      email: null,
      phone: null,
      current_company: entry.candidate?.current_company ?? null,
      current_position: entry.candidate?.current_position ?? null,
      experience_years: entry.candidate?.experience_years ?? null,
      verified_experience_years: entry.candidate?.verified_experience_years ?? null,
      experience_years_status: entry.candidate?.experience_years_status ?? null,
      experience_years_evidence: null,
      education: entry.candidate?.education ?? null,
      skills: entry.candidate?.skills ?? null,
      resume_text: null,
      created_at: '',
      authorization: null,
    };
  }

  function resolveProfileMatchRecord(candidateId: string): MatchRecord | null {
    if (!selectedRun) return null;
    return matchRecords.find(
      (record) => record.job_id === selectedRun.job_id && record.candidate_id === candidateId,
    ) ?? null;
  }

  function profileName(candidateId: string): string {
    const direct = candidates.find((candidate) => candidate.id === candidateId);
    if (direct) return direct.name;
    const entry = selectedRun?.entries.find((item) => item.candidate_id === candidateId);
    return entry?.candidate?.name ?? '候选人';
  }

  function openProfile(candidateId: string) {
    setOpenProfileIds((previous) =>
      previous.includes(candidateId) ? previous : [...previous, candidateId],
    );
    setViewMode(candidateId);
  }

  function closeProfile(candidateId: string) {
    setOpenProfileIds((previous) => previous.filter((id) => id !== candidateId));
    setViewMode((previous) => (previous === candidateId ? 'table' : previous));
  }

  function gotoDecision(entryId: string) {
    setViewMode('card');
    // 卡片视图切换后目标卡片才挂载；先等一帧渲染，再滚动定位。
    window.setTimeout(() => {
      const target = document.getElementById(`entry-card-${entryId}`);
      if (!target) return;
      const before = window.scrollY;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // smooth 滚动在禁用动画的环境（自动化浏览器/reduced-motion）下可能不生效，兜底立即定位。
      window.setTimeout(() => {
        if (window.scrollY === before) {
          target.scrollIntoView({ behavior: 'auto', block: 'start' });
        }
      }, 300);
    }, 80);
  }

  function jobTitle(run: ShortlistRun): string {
    return run.job?.title || jobs.find((job) => job.id === run.job_id)?.title || run.job_id;
  }

  // 当前批次对应职位的年限口径（计划 §4.5）：零接口新增，直接读职位 screening_rubric。
  const bandSummary = useMemo(() => {
    if (!selectedRun) return null;
    const job = jobs.find((item) => item.id === selectedRun.job_id);
    const band = job?.screening_rubric?.experience_band;
    if (!band) return null;
    const label = formatExperienceBand(band);
    if (!label) return null;
    const sourceText = band.source === 'explicit' ? 'JD 明确' : 'AI 推断';
    if (band.hard_max !== null && band.hard_max_enabled) {
      return `${label}（${sourceText}，超过 ${band.hard_max} 年为硬门槛）`;
    }
    return `${label}（${sourceText}，未设为硬门槛）`;
  }, [jobs, selectedRun]);

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

  async function pollShortlistStatus(runId: string) {
    const totalElapsed = Math.floor(
      (Date.now() - progressStartedAtRef.current) / 1000,
    );
    if (totalElapsed >= SHORTLIST_TOTAL_TIMEOUT_SECONDS) {
      setProgress(null);
      toast.warning('智能匹配耗时过长，已停止自动等待，请稍后重新进入本页查看');
      return;
    }
    try {
      const response = await authFetch(`/api/shortlists/${runId}/status`);
      const result: {
        success?: boolean;
        data?: { status?: string; candidateCount?: number; errorMessage?: string; progress?: unknown };
        error?: string;
      } = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '进度查询失败');
      }
      const status = result.data?.status;
      if (status === 'ready') {
        setProgress(null);
        await loadRuns();
        setSelectedRunId(runId);
        toast.success(
          `智能匹配完成，已生成短名单（${result.data?.candidateCount ?? 0} 位候选人）`,
        );
        return;
      }
      if (status === 'failed') {
        setProgress(null);
        await loadRuns();
        toast.error(result.data?.errorMessage || '智能匹配失败');
        return;
      }
      const parsedProgress = parseShortlistStage(result.data?.progress);
      setProgress({
        status: status === 'running' ? 'running' : 'pending',
        elapsed: totalElapsed,
        stalled: status === 'pending' && totalElapsed >= SHORTLIST_PENDING_STALL_SECONDS,
        ...parsedProgress,
      });
      pollRef.current = setTimeout(
        () => void pollShortlistStatus(runId),
        SHORTLIST_POLL_INTERVAL_MS,
      );
    } catch {
      if (totalElapsed >= SHORTLIST_TOTAL_TIMEOUT_SECONDS) {
        setProgress(null);
        toast.warning('智能匹配进度查询超时，请稍后重新进入本页查看');
        return;
      }
      pollRef.current = setTimeout(
        () => void pollShortlistStatus(runId),
        SHORTLIST_POLL_INTERVAL_MS,
      );
    }
  }

  async function createShortlist() {
    if (!selectedJob) {
      toast.error('请先选择已启用的职位');
      return;
    }
    if (boundCandidates.length === 0) {
      toast.error('该职位还没有已入库且有效绑定的候选人');
      return;
    }

    setCreatingShortlist(true);
    try {
      const response = await authFetch('/api/shortlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: selectedJob.id,
          candidate_ids: boundCandidates.map((candidate) => candidate.id),
          top_n: Math.min(10, boundCandidates.length),
          client_event_id: crypto.randomUUID(),
        }),
      });
      const result: {
        success?: boolean;
        data?: { shortlist_run_id?: string };
        error?: string;
      } = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '短名单任务提交失败');
      }
      const runId = result.data?.shortlist_run_id;
      if (!runId) throw new Error('短名单任务创建失败');
      progressStartedAtRef.current = Date.now();
      setProgress({ status: 'pending', elapsed: 0, stalled: false, stage: null, scoredCandidates: 0, totalCandidates: 0 });
      pollRef.current = setTimeout(
        () => void pollShortlistStatus(runId),
        SHORTLIST_POLL_INTERVAL_MS,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '短名单任务提交失败');
    } finally {
      setCreatingShortlist(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Human review</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">候选人短名单</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">按职位筛选出值得重点评估的候选人，先审证据再做人工判断。</p></div>
      </div>

      <Card className="border-blue-200 bg-blue-50/40 shadow-none">
        <CardContent className="grid gap-4 pt-6 lg:grid-cols-2 lg:items-start">
          <div className="space-y-3">
            <Label htmlFor="shortlist-job">选择职位（仅匹配已入库且有效绑定的候选人）</Label>
            <Select value={selectedJobId} onValueChange={setSelectedJobId} disabled={activeJobs.length === 0 || creatingShortlist}>
              <SelectTrigger id="shortlist-job" className="w-full bg-card">
                <SelectValue placeholder="选择要匹配的职位" />
              </SelectTrigger>
              <SelectContent>
                {activeJobs.map((job) => (
                  <SelectItem key={job.id} value={job.id}>
                    {job.title}{job.department ? ` · ${job.department}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">
              {selectedJob
                ? `当前职位已有 ${boundCandidates.length} 位候选人完成入库并有效绑定。`
                : '请先在第一步启用职位，并在第二步完成候选人入库。'}
            </p>
            <Button onClick={() => void createShortlist()} disabled={!selectedJob || boundCandidates.length === 0 || creatingShortlist || progress !== null}>
              {creatingShortlist ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {creatingShortlist ? '提交中…' : progress ? '匹配中…' : 'AI智能匹配'}
            </Button>
          </div>
          <div className="space-y-3">
            <Label htmlFor="shortlist-run">职位与短名单批次</Label>
            <Select value={selectedRunId} onValueChange={setSelectedRunId} disabled={runs.length === 0}>
              <SelectTrigger id="shortlist-run" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{runs.map((run) => <SelectItem key={run.id} value={run.id}>{jobTitle(run)} · {formatDate(run.requested_at)}</SelectItem>)}</SelectContent>
            </Select>
            {runs.length === 0 ? (
              <p className="text-xs text-slate-500">还没有短名单，请先在左侧选择职位并开始智能匹配。</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{selectedRun?.candidate_count ?? 0} 位候选人</Badge><Badge variant="outline">已审 {reviewedCount}/{selectedRun?.entries.length ?? 0}</Badge>{selectedRun?.qualified_at ? <Badge className="bg-emerald-100 text-emerald-800"><UserCheck className="mr-1 h-3 w-3" />HR 已确认合格</Badge> : <Button size="sm" onClick={() => void qualifyRun()} disabled={qualifying || acceptedCount === 0}><UserCheck className="mr-2 h-4 w-4" />{qualifying ? '确认中…' : '确认合格短名单'}</Button>}</div>
            )}
          </div>
          {progress && (
            <div className="space-y-3 rounded-lg border border-blue-200 bg-card p-4 lg:col-span-2">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <span className="font-medium text-slate-900">正在智能匹配</span>
                <span className="ml-auto text-xs text-slate-500">已 {progress.elapsed} 秒</span>
              </div>
              <Progress value={shortlistProgressValue(progress)} />
              {progress.status === 'pending' ? (
                <p className="text-xs text-slate-600">任务已提交，等待匹配 Worker 领取并处理…</p>
              ) : (
                <ol className="space-y-1.5">
                  {SHORTLIST_STAGES.map((stage) => {
                    const stageIndex = SHORTLIST_STAGES.findIndex((item) => item.stage === stage.stage);
                    const currentIndex = shortlistStageIndex(progress.stage);
                    const isDone = currentIndex > stageIndex;
                    const isCurrent = currentIndex === stageIndex;
                    const isScoring = stage.stage === 'scoring' && isCurrent;
                    return (
                      <li
                        key={stage.stage}
                        className={cn(
                          'flex items-center gap-2 text-xs',
                          isCurrent ? 'text-slate-900' : isDone ? 'text-slate-500' : 'text-slate-400',
                        )}
                      >
                        {isDone ? (
                          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        ) : isCurrent ? (
                          <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
                        ) : (
                          <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-slate-300" />
                        )}
                        <span>
                          {stage.label}
                          {isScoring && progress.totalCandidates > 0
                            ? `（${progress.scoredCandidates}/${progress.totalCandidates}）`
                            : ''}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
              {progress.stalled && (
                <p className="text-xs leading-5 text-amber-700">
                  任务仍在排队，请确认匹配 Worker 已启动（<code className="rounded bg-slate-100 px-1 py-0.5">pnpm worker:match</code>）。
                  也可运行 <code className="rounded bg-slate-100 px-1 py-0.5">pnpm worker:match:once</code> 单次处理一个任务后退出。
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <ShortlistConceptGuide />

      {loading ? <div className="space-y-4"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-96 rounded-xl" /></div> : runs.length === 0 ? (
        <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>还没有短名单</AlertTitle><AlertDescription>请先确认职位、完成候选人入库，然后在上方选择职位开始智能匹配。</AlertDescription></Alert>
      ) : (
        <>
          {selectedRun && (
            <Tabs value={viewMode} onValueChange={setViewMode}>
              <TabsList>
                <TabsTrigger value="table">排序表（横向比较）</TabsTrigger>
                <TabsTrigger value="card">逐条审阅（记录决策）</TabsTrigger>
                {openProfileIds.map((candidateId) => (
                  <TabsTrigger key={candidateId} value={candidateId}>
                    <span className="max-w-32 truncate">{profileName(candidateId)}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`关闭${profileName(candidateId)}详情`}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeProfile(candidateId);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.stopPropagation();
                          closeProfile(candidateId);
                        }
                      }}
                      className="ml-1 inline-flex items-center rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-slate-200 hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="table" className="space-y-4">
                <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 text-xs leading-5 text-slate-700">
                  结论等级仅用于安排评估优先级，可由 HR 人工覆盖；排序分不用于自动拒绝。{bandSummary && <span>本批年限口径：{bandSummary}。</span>}
                </div>
                <MatchRankingTable
                  entries={selectedRun.entries}
                  onOpenProfile={openProfile}
                  onGotoDecision={gotoDecision}
                  onGenerateGuide={(entry) => router.push(`/interview-guides?entry=${entry.id}`)}
                />
              </TabsContent>
              <TabsContent value="card">
                {selectedRun.entries.length ? (
                  <div className="space-y-5">
                    {[...selectedRun.entries].sort((left, right) => left.rank - right.rank).map((entry) => (
                      <ShortlistEntryCard key={entry.id} entry={entry} onChanged={loadRuns} />
                    ))}
                  </div>
                ) : (
                  <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>短名单正在准备</AlertTitle><AlertDescription>当前批次尚无可审阅条目，请稍后刷新。</AlertDescription></Alert>
                )}
              </TabsContent>
              {openProfileIds.map((candidateId) => {
                const profileCandidate = resolveProfileCandidate(candidateId);
                const incompleteHint =
                  profileCandidate !== null &&
                  !candidates.some((candidate) => candidate.id === candidateId);
                return (
                  <TabsContent
                    key={candidateId}
                    value={candidateId}
                    forceMount
                    className="data-[state=inactive]:hidden"
                  >
                    <CandidateDetailPanel
                      candidate={profileCandidate}
                      matchRecord={resolveProfileMatchRecord(candidateId)}
                      onBack={() => closeProfile(candidateId)}
                      incompleteHint={incompleteHint}
                    />
                  </TabsContent>
                );
              })}
            </Tabs>
          )}
        </>
      )}
    </div>
  );
}
