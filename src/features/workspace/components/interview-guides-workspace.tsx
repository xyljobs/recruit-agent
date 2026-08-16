'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ClipboardList,
  Copy,
  Plus,
  Printer,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { authFetch } from '@/lib/auth-client';
import type { ShortlistRun } from '../decision-types';
import { normalizeShortlistRuns } from '../lib/decision-ui';
import {
  generateInterviewGuide,
  guideToPlainText,
  type InterviewGuideContent,
  type PreparedInterviewGuide,
} from './interview-guide-panel';

type TargetedQuestion = InterviewGuideContent['targeted_questions'][number];
type CommonQuestion = InterviewGuideContent['common_questions'][number];

const ORIGIN_LABELS: Record<TargetedQuestion['origin'], string> = {
  evidence_gap: '证据缺口',
  depth_check: '证据深挖',
  boundary_risk: '边界风险',
  resume_probe: '简历追问',
};

function normalizeContent(content: InterviewGuideContent): InterviewGuideContent {
  return {
    ...content,
    common_questions: content.common_questions.map(item => ({ ...item, answer: item.answer ?? '' })),
    targeted_questions: content.targeted_questions.map(item => ({ ...item, answer: item.answer ?? '' })),
  };
}

function nonEmpty<T extends { question: string }>(items: T[]): T[] {
  return items.filter(item => item.question.trim().length > 0);
}

export function InterviewGuidesWorkspace() {
  const [runs, setRuns] = useState<ShortlistRun[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [entryId, setEntryId] = useState('');
  const [guide, setGuide] = useState<PreparedInterviewGuide | null>(null);
  const [content, setContent] = useState<InterviewGuideContent | null>(null);
  const [loadingGuide, setLoadingGuide] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [copying, setCopying] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const options = useMemo(
    () => runs.flatMap(run => run.entries
      .filter(entry => entry.human_decision === 'accepted' || entry.human_decision === 'overridden')
      .map(entry => ({
        entryId: entry.id,
        label: `${entry.candidate?.name ?? `候选人 ${entry.rank}`} · ${run.job?.title ?? run.job_id}`,
      }))),
    [runs],
  );

  const loadEntries = useCallback(async () => {
    setLoadingEntries(true);
    try {
      const response = await authFetch('/api/shortlists');
      const result: { success?: boolean; data?: unknown; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '短名单加载失败');
      setRuns(normalizeShortlistRuns(result.data));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '短名单加载失败');
      setRuns([]);
    } finally {
      setLoadingEntries(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEntryId(params.get('entry') ?? '');
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    if (!entryId && options.length > 0) {
      setEntryId(options[0].entryId);
    }
  }, [entryId, options]);

  const loadGuide = useCallback(async (id: string) => {
    setLoadingGuide(true);
    setGuide(null);
    setContent(null);
    setDirty(false);
    try {
      const response = await authFetch(`/api/interview/entry-guide?shortlistEntryId=${id}`);
      const result: { success?: boolean; data?: PreparedInterviewGuide | null; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '面试提纲加载失败');
      if (result.data) {
        setGuide(result.data);
        setContent(normalizeContent(result.data.content));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '面试提纲加载失败');
    } finally {
      setLoadingGuide(false);
    }
  }, []);

  useEffect(() => {
    if (entryId) void loadGuide(entryId);
  }, [entryId, loadGuide]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  function scheduleSave(next: InterviewGuideContent) {
    setDirty(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void save(next);
    }, 800);
  }

  async function save(snapshot: InterviewGuideContent) {
    const guideId = guide?.guide?.id;
    if (!guideId) return;
    setSaving(true);
    try {
      const response = await authFetch(`/api/interview/guides/${guideId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions: {
            common_questions: nonEmpty(snapshot.common_questions),
            targeted_questions: nonEmpty(snapshot.targeted_questions),
          },
        }),
      });
      const result: { success?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存失败');
      setDirty(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  function patchCommon(index: number, patch: Partial<CommonQuestion>) {
    if (!content) return;
    const next: InterviewGuideContent = {
      ...content,
      common_questions: content.common_questions.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    };
    setContent(next);
    scheduleSave(next);
  }

  function patchTargeted(index: number, patch: Partial<TargetedQuestion>) {
    if (!content) return;
    const next: InterviewGuideContent = {
      ...content,
      targeted_questions: content.targeted_questions.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    };
    setContent(next);
    scheduleSave(next);
  }

  function addCommon() {
    if (!content) return;
    const next: InterviewGuideContent = {
      ...content,
      common_questions: [...content.common_questions, { question: '', dimension: '', answer: '' }],
    };
    setContent(next);
    scheduleSave(next);
  }

  function addTargeted() {
    if (!content) return;
    const next: InterviewGuideContent = {
      ...content,
      targeted_questions: [
        ...content.targeted_questions,
        {
          question: '',
          dimension: '',
          origin: 'depth_check',
          expected_signals: [],
          probe_followups: [],
          scoring_anchors: [],
          answer: '',
        },
      ],
    };
    setContent(next);
    scheduleSave(next);
  }

  function removeCommon(index: number) {
    if (!content) return;
    const next: InterviewGuideContent = {
      ...content,
      common_questions: content.common_questions.filter((_, i) => i !== index),
    };
    setContent(next);
    scheduleSave(next);
  }

  function removeTargeted(index: number) {
    if (!content) return;
    const next: InterviewGuideContent = {
      ...content,
      targeted_questions: content.targeted_questions.filter((_, i) => i !== index),
    };
    setContent(next);
    scheduleSave(next);
  }

  async function handleGenerate() {
    if (!entryId) return;
    setGenerating(true);
    setPreview('');
    try {
      const data = await generateInterviewGuide(entryId, text => setPreview(text));
      setGuide(data);
      setContent(normalizeContent(data.content));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '面试提纲生成失败');
    } finally {
      setGenerating(false);
      setPreview('');
    }
  }

  async function handleCopy() {
    if (!content) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(guideToPlainText(content, guide?.candidate_name ?? '候选人'));
      toast.success('面试提纲已复制到剪贴板');
    } catch {
      toast.error('复制失败，请手动选择文本复制');
    } finally {
      setCopying(false);
    }
  }

  function handlePrint() {
    if (!content) return;
    const host = document.createElement('div');
    host.className = 'interview-guide-print';
    const body = document.createElement('pre');
    body.className = 'interview-guide-print-body';
    body.textContent = guideToPlainText(content, guide?.candidate_name ?? '候选人');
    host.appendChild(body);
    document.body.appendChild(host);
    window.print();
    host.remove();
  }

  const candidateName = guide?.candidate_name ?? '候选人';
  const selectedOption = options.find(option => option.entryId === entryId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Interview guide</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">面试提纲</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">为已接受或已覆盖的候选人准备面试提纲，题目可编辑、删除、新增，并在面试时逐题记录候选人回答。</p>
        </div>
        <div className="w-full max-w-md">
          <Label htmlFor="guide-entry">选择候选人</Label>
          <Select value={entryId} onValueChange={setEntryId} disabled={loadingEntries || options.length === 0}>
            <SelectTrigger id="guide-entry" className="w-full bg-card">
              <SelectValue placeholder={loadingEntries ? '加载中…' : '选择已接受/已覆盖的候选人'} />
            </SelectTrigger>
            <SelectContent>
              {options.map(option => (
                <SelectItem key={option.entryId} value={option.entryId}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loadingEntries ? (
        <div className="space-y-4"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-96 rounded-xl" /></div>
      ) : options.length === 0 ? (
        <Alert>
          <AlertTitle>还没有可生成面试提纲的候选人</AlertTitle>
          <AlertDescription>
            面试提纲只能为人工「接受推荐」或「覆盖推荐」的候选人准备。请先在
            <Link href="/shortlists" className="mx-1 font-medium text-blue-700 underline underline-offset-4">候选人短名单</Link>
            完成人工决策。
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-4">
          {loadingGuide ? (
            <Skeleton className="h-96 rounded-xl" />
          ) : !guide || !content ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-blue-600" />为 {selectedOption?.label ?? '该候选人'} 生成面试提纲</CardTitle>
                <CardDescription>基于匹配证据、缺口与边界风险生成，生成后可在下方编辑题目并记录回答。</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => void handleGenerate()} disabled={generating}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
                  {generating ? '生成中…' : 'AI生成面试提纲'}
                </Button>
                {generating && (
                  <div className="mt-3 max-h-48 overflow-y-auto rounded-lg bg-muted/50 p-3">
                    <p className="mb-1 text-xs text-muted-foreground">AI 正在生成面试提纲，过程实时显示：</p>
                    <pre className="whitespace-pre-wrap break-words font-sans text-xs text-muted-foreground">{preview || '正在连接模型…'}</pre>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="gap-0 overflow-hidden border-slate-200 py-0 shadow-none">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">面试提纲 · {candidateName}</h3>
                  <Badge variant="outline">{guide.guide?.ai_mode === 'rules_only' ? '纯规则生成' : 'AI 辅助生成'}</Badge>
                  <Badge variant="outline" className={dirty ? 'text-amber-700' : 'text-emerald-700'}>
                    {saving ? '保存中…' : dirty ? '未保存' : '已保存'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => void handleCopy()} disabled={copying}><Copy className="mr-1.5 h-3.5 w-3.5" />复制全文</Button>
                  <Button size="sm" variant="outline" onClick={handlePrint}><Printer className="mr-1.5 h-3.5 w-3.5" />打印</Button>
                </div>
              </div>
              <CardContent className="space-y-8 py-6">
                <section>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">考察重点</h4>
                  {content.focus_areas.length > 0 ? (
                    <ul className="mt-2 space-y-2">
                      {content.focus_areas.map(area => (
                        <li key={`${area.dimension}-${area.why}`} className="flex flex-wrap items-start gap-2 text-sm">
                          <Badge variant="outline">{area.dimension}</Badge>
                          {area.must_verify && <Badge className="bg-red-100 text-red-800">必须核实</Badge>}
                          <span className="text-slate-600">{area.why}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-2 text-sm text-slate-400">暂无</p>}
                </section>

                <section>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">公共必问题</h4>
                      <p className="mt-1 text-xs text-slate-400">来自 HR 题库，可编辑；改动仅影响本提纲，不改动题库原文</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={addCommon}><Plus className="mr-1.5 h-3.5 w-3.5" />新增公共题</Button>
                  </div>
                  <div className="mt-3 space-y-3">
                    {content.common_questions.map((item, index) => (
                      <QuestionEditor
                        key={`common-${index}`}
                        question={item.question}
                        dimension={item.dimension}
                        answer={item.answer ?? ''}
                        origin={null}
                        onQuestionChange={value => patchCommon(index, { question: value })}
                        onDimensionChange={value => patchCommon(index, { dimension: value })}
                        onAnswerChange={value => patchCommon(index, { answer: value })}
                        onRemove={() => removeCommon(index)}
                      />
                    ))}
                  </div>
                </section>

                <section>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">候选人专项题</h4>
                      <p className="mt-1 text-xs text-slate-400">按证据缺口、冲突与边界风险生成的个性化题目</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={addTargeted}><Plus className="mr-1.5 h-3.5 w-3.5" />新增专项题</Button>
                  </div>
                  <div className="mt-3 space-y-3">
                    {content.targeted_questions.map((item, index) => (
                      <QuestionEditor
                        key={`targeted-${index}`}
                        question={item.question}
                        dimension={item.dimension}
                        answer={item.answer ?? ''}
                        origin={item.origin}
                        onQuestionChange={value => patchTargeted(index, { question: value })}
                        onDimensionChange={value => patchTargeted(index, { dimension: value })}
                        onAnswerChange={value => patchTargeted(index, { answer: value })}
                        onRemove={() => removeTargeted(index)}
                      />
                    ))}
                  </div>
                </section>

                <section className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">风险核查</h4>
                    {content.red_flags_to_check.length > 0 ? (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{content.red_flags_to_check.map(item => <li key={item}>{item}</li>)}</ul>
                    ) : <p className="mt-2 text-sm text-slate-400">暂无</p>}
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">面试轮次建议</h4>
                    <ul className="mt-2 space-y-1 text-sm text-slate-600">
                      {content.interview_loop.map(item => <li key={`${item.round}-${item.focus}`}>第 {item.round} 轮（{item.minutes} 分钟 · {item.interviewer_role}）：{item.focus}</li>)}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">禁问提示</h4>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{content.prohibited_topics.join('、')}等内容禁止在面试中询问。</p>
                  </div>
                </section>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function QuestionEditor({
  question,
  dimension,
  answer,
  origin,
  onQuestionChange,
  onDimensionChange,
  onAnswerChange,
  onRemove,
}: {
  question: string;
  dimension: string;
  answer: string;
  origin: TargetedQuestion['origin'] | null;
  onQuestionChange: (value: string) => void;
  onDimensionChange: (value: string) => void;
  onAnswerChange: (value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-start gap-2">
        {origin && <Badge className="mt-2 shrink-0">{ORIGIN_LABELS[origin]}</Badge>}
        <Input value={question} onChange={event => onQuestionChange(event.target.value)} placeholder="输入面试题目" className="flex-1" />
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label="删除题目" className="shrink-0 text-red-500 hover:text-red-600">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-2">
        <Label className="text-xs text-slate-500">考察点</Label>
        <Input value={dimension} onChange={event => onDimensionChange(event.target.value)} placeholder="例如：项目经验、团队协作" className="mt-1" />
      </div>
      <div className="mt-2">
        <Label className="text-xs text-slate-500">候选人回答（面试时记录）</Label>
        <Textarea value={answer} onChange={event => onAnswerChange(event.target.value)} placeholder="记录候选人的回答要点…" className="mt-1 min-h-16" />
      </div>
    </div>
  );
}
