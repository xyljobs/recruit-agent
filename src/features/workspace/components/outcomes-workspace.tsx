'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Handshake,
  ListTodo,
  MessageSquareReply,
  MessageSquareText,
  PhoneOutgoing,
  ShieldAlert,
  UserRoundX,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { authFetch } from '@/lib/auth-client';
import { useWorkspaceData } from '../hooks/use-workspace-data';
import { outcomeReasonLabel } from '../lib/decision-ui';

const OUTCOME_GROUPS = [
  {
    label: '沟通',
    options: [
      ['outreach_sent', '已触达'],
      ['candidate_replied', '候选人已回复'],
    ],
  },
  {
    label: '面试',
    options: [
      ['interview_scheduled', '已安排面试'],
      ['interview_feedback', '面试反馈'],
      ['interview_completed', '已完成面试'],
      ['qualified_interview', '合格面试'],
    ],
  },
  {
    label: '后续结果',
    options: [
      ['offer', '已发 Offer'],
      ['offer_details', 'Offer 明细'],
      ['hired', '已录用'],
      ['rejected', '人工拒绝'],
      ['withdrawn', '候选人撤回'],
      ['complaint', '候选人投诉'],
    ],
  },
] as const;

const STATUS_LABELS: Record<string, string> = {
  pending: '待接触', contacted: '已联系', interviewing: '面试中', offered: '已发 Offer', hired: '已录用', rejected: '已拒绝', withdrawn: '已撤回',
};

const OUTREACH_TASK_STATUS_LABELS: Record<string, string> = {
  pending: '待触达',
  contacted: '已触达',
  replied: '已回复',
  no_response: '未响应',
  closed: '已关闭',
};

interface OutreachTaskItem {
  id: string;
  candidate_name: string;
  job_title: string;
  status: string;
  due_at: string;
  script_snapshot: string | null;
  note: string | null;
}

interface OutcomeEventItem {
  id: string;
  event_type: string;
  target_stage: string | null;
  reason_code: string | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
  recorded_at: string;
}

interface AvailableGuideItem {
  id: string;
  created_at: string;
  ai_mode: string;
  targeted_questions: Array<{ question: string | null; origin: string | null; dimension: string | null }>;
}

function formatInterviewSchedule(event: OutcomeEventItem): string | null {
  const scheduledAt = event.metadata?.scheduled_at;
  if (typeof scheduledAt !== 'string' || !scheduledAt) return null;
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) return null;
  const method = typeof event.metadata?.method === 'string' ? event.metadata.method : '';
  return `${date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}${method ? ` · ${method}` : ''}`;
}

interface OutboundConnection {
  id: string;
  name: string;
  status: string;
  capabilities: string[];
}

export function OutcomesWorkspace() {
  const { matchRecords, loading, reloadDashboard, reloadMatchRecords } = useWorkspaceData();
  const [matchId, setMatchId] = useState('');
  const [eventType, setEventType] = useState('outreach_sent');
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [writebackConnectionId, setWritebackConnectionId] = useState('none');
  const [outboundConnections, setOutboundConnections] = useState<OutboundConnection[]>([]);
  const [saving, setSaving] = useState(false);
  const [outreachTasks, setOutreachTasks] = useState<OutreachTaskItem[]>([]);
  const [outreachLoading, setOutreachLoading] = useState(true);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [scriptTask, setScriptTask] = useState<OutreachTaskItem | null>(null);
  const [scriptDialogOpen, setScriptDialogOpen] = useState(false);
  // P1-3：面试/Offer 轻量记录的动态字段
  const [interviewScheduledAt, setInterviewScheduledAt] = useState('');
  const [interviewMethod, setInterviewMethod] = useState('现场');
  const [interviewers, setInterviewers] = useState('');
  const [feedbackSummary, setFeedbackSummary] = useState('');
  const [feedbackVerdict, setFeedbackVerdict] = useState('pass');
  // P3-1：面试反馈可关联已生成提纲，并逐题记录命中情况（作为校准输入）
  const [availableGuides, setAvailableGuides] = useState<AvailableGuideItem[]>([]);
  const [feedbackGuideId, setFeedbackGuideId] = useState('');
  const [questionRatings, setQuestionRatings] = useState<Record<string, 'hit' | 'miss' | 'skipped'>>({});
  const [compensationNote, setCompensationNote] = useState('');
  const [approvalNote, setApprovalNote] = useState('');
  const [matchEvents, setMatchEvents] = useState<OutcomeEventItem[]>([]);

  useEffect(() => {
    let active = true;
    void authFetch('/api/integrations')
      .then(response => response.json())
      .then((result: { data?: { connections?: OutboundConnection[] } }) => {
        if (!active) return;
        setOutboundConnections((result.data?.connections ?? []).filter(connection => (
          connection.status === 'enabled'
          && connection.capabilities.includes('outbound_outcomes')
        )));
      })
      .catch(() => {
        if (active) setOutboundConnections([]);
      });
    return () => { active = false; };
  }, []);

  async function loadOutreachTasks() {
    try {
      const response = await authFetch('/api/outreach-tasks');
      const result: { success?: boolean; data?: OutreachTaskItem[]; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '获取触达待办失败');
      setOutreachTasks(result.data ?? []);
    } catch {
      setOutreachTasks([]);
    } finally {
      setOutreachLoading(false);
    }
  }

  useEffect(() => {
    void loadOutreachTasks();
  }, []);

  async function markOutreachTask(taskId: string, status: string, successMessage: string) {
    setUpdatingTaskId(taskId);
    try {
      const response = await authFetch(`/api/outreach-tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const result: { success?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '更新触达待办失败');
      toast.success(successMessage);
      await Promise.all([loadOutreachTasks(), reloadMatchRecords(), reloadDashboard()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新触达待办失败');
    } finally {
      setUpdatingTaskId(null);
    }
  }

  const selectedMatch = useMemo(() => matchRecords.find((record) => record.id === matchId) ?? null, [matchId, matchRecords]);
  const reasonLabel = outcomeReasonLabel(eventType);
  const needsReason = reasonLabel !== null;

  async function loadMatchEvents(matchRecordId: string) {
    try {
      const response = await authFetch(`/api/outcomes?matchRecordId=${matchRecordId}`);
      const result: { success?: boolean; data?: OutcomeEventItem[]; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '获取结果事件失败');
      setMatchEvents(result.data ?? []);
    } catch {
      setMatchEvents([]);
    }
  }

  async function loadAvailableGuides(matchRecordId: string) {
    try {
      const response = await authFetch(`/api/interview/guides?matchRecordId=${matchRecordId}`);
      const result: { success?: boolean; data?: AvailableGuideItem[]; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '获取面试提纲失败');
      setAvailableGuides(result.data ?? []);
    } catch {
      setAvailableGuides([]);
    }
  }

  useEffect(() => {
    if (selectedMatch) {
      void loadMatchEvents(selectedMatch.id);
      void loadAvailableGuides(selectedMatch.id);
      setFeedbackGuideId('');
      setQuestionRatings({});
    } else {
      setMatchEvents([]);
      setAvailableGuides([]);
    }
  }, [selectedMatch?.id]);

  const selectedGuide = useMemo(
    () => availableGuides.find((guide) => guide.id === feedbackGuideId) ?? null,
    [availableGuides, feedbackGuideId],
  );

  function handleGuideSelect(guideId: string) {
    // 'none' 表示不关联：统一回落为空串，避免混入提交载荷
    setFeedbackGuideId(guideId === 'none' ? '' : guideId);
    setQuestionRatings({});
  }

  function guideOptionLabel(guide: AvailableGuideItem): string {
    const date = new Date(guide.created_at);
    const label = Number.isNaN(date.getTime())
      ? guide.created_at
      : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `${guide.ai_mode === 'rules_only' ? '纯规则' : 'AI 辅助'}提纲 · ${label}`;
  }

  const questionResults = useMemo(() => {
    if (!selectedGuide) return [];
    return selectedGuide.targeted_questions
      .filter((item) => item.question && item.origin && questionRatings[item.question] && questionRatings[item.question] !== 'skipped')
      .map((item) => ({
        question: item.question as string,
        origin: item.origin as string,
        hit: questionRatings[item.question as string] === 'hit',
      }));
  }, [selectedGuide, questionRatings]);

  const latestInterview = useMemo(() => {
    const scheduled = matchEvents.filter((event) => event.event_type === 'interview_scheduled');
    return scheduled.length > 0 ? scheduled[scheduled.length - 1] : null;
  }, [matchEvents]);
  const latestInterviewText = latestInterview ? formatInterviewSchedule(latestInterview) : null;

  async function recordOutcome() {
    if (!matchId) {
      toast.error('请选择候选人与职位');
      return;
    }
    if (needsReason && !reasonCode.trim()) {
      toast.error(eventType === 'rejected' ? '人工拒绝必须填写原因' : '请填写投诉分类');
      return;
    }
    const interviewerList = interviewers.split(/[,，、;；\n]/).map((item) => item.trim()).filter(Boolean);
    if (eventType === 'interview_scheduled') {
      if (!interviewScheduledAt) {
        toast.error('请填写面试时间');
        return;
      }
      if (interviewerList.length === 0) {
        toast.error('请填写至少一位面试官');
        return;
      }
    }
    if (eventType === 'interview_feedback' && !feedbackSummary.trim()) {
      toast.error('请填写面试反馈摘要');
      return;
    }
    if (eventType === 'offer_details' && !compensationNote.trim() && !approvalNote.trim()) {
      toast.error('请至少填写薪酬或审批说明之一');
      return;
    }
    const metadata: Record<string, unknown> | undefined = eventType === 'interview_scheduled'
      ? { scheduled_at: new Date(interviewScheduledAt).toISOString(), method: interviewMethod, interviewers: interviewerList }
      : eventType === 'interview_feedback'
        ? {
            summary: feedbackSummary.trim(),
            verdict: feedbackVerdict,
            ...(feedbackGuideId ? { interview_guide_id: feedbackGuideId } : {}),
            ...(questionResults.length > 0 ? { question_results: questionResults } : {}),
          }
        : eventType === 'offer_details'
          ? {
              ...(compensationNote.trim() ? { compensation_note: compensationNote.trim() } : {}),
              ...(approvalNote.trim() ? { approval_note: approvalNote.trim() } : {}),
            }
          : undefined;
    setSaving(true);
    try {
      const response = await authFetch('/api/outcomes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_record_id: matchId,
          event_type: eventType,
          client_event_id: crypto.randomUUID(),
          occurred_at: new Date(occurredAt).toISOString(),
          ...(reasonCode.trim() ? { reason_code: reasonCode.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(metadata ? { metadata } : {}),
          ...(writebackConnectionId !== 'none' ? {
            writeback_connection_id: writebackConnectionId,
            writeback_client_event_id: crypto.randomUUID(),
          } : {}),
        }),
      });
      const result: { success?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '真实结果记录失败');
      toast.success(writebackConnectionId === 'none'
        ? '真实招聘结果已记录'
        : '结果与 ATS 回写意图已同时记录');
      setReasonCode('');
      setNote('');
      setInterviewScheduledAt('');
      setInterviewers('');
      setFeedbackSummary('');
      setCompensationNote('');
      setApprovalNote('');
      setFeedbackGuideId('');
      setQuestionRatings({});
      await Promise.all([reloadMatchRecords(), reloadDashboard(), loadMatchEvents(matchId)]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '真实结果记录失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Outcome ledger</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">沟通与结果</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">把触达、面试、Offer 与录用记录成真实事件，用结果校准下一轮短名单。拒绝和录用始终由人确认。</p></div>

      <Alert className="border-blue-200 bg-blue-50/60"><ShieldAlert className="h-4 w-4 text-blue-700" /><AlertTitle>AI 不能替你作出就业决定</AlertTitle><AlertDescription>系统只提供证据和排序建议；拒绝、Offer、录用和任何对外写回都需要已登录用户明确操作并留下理由。</AlertDescription></Alert>

      <Card className="border-slate-200 shadow-none">
        <CardHeader><CardTitle className="flex items-center gap-2"><ListTodo className="h-5 w-5 text-blue-700" />触达待办</CardTitle><CardDescription>短名单决策通过后自动生成；标记已触达/已回复/未响应会同步写入结果事件台账。</CardDescription></CardHeader>
        <CardContent>
          {outreachLoading ? (
            <p className="text-sm text-slate-500">加载中…</p>
          ) : outreachTasks.length === 0 ? (
            <p className="text-sm text-slate-500">暂无待办：短名单决策通过后将自动生成</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {outreachTasks.map(task => {
                const overdue = new Date(task.due_at).getTime() < Date.now()
                  && (task.status === 'pending' || task.status === 'contacted');
                const updating = updatingTaskId === task.id;
                return (
                  <div key={task.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-950">{task.candidate_name} · {task.job_title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />截止：{new Date(task.due_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                        <Badge variant="secondary">{OUTREACH_TASK_STATUS_LABELS[task.status] || task.status}</Badge>
                        {overdue && <Badge variant="destructive">已逾期</Badge>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {task.script_snapshot && (
                        <Button
                          size="sm"
                          disabled={updating}
                          onClick={() => { setScriptTask(task); setScriptDialogOpen(true); }}
                        >
                          <MessageSquareText className="mr-1 h-3.5 w-3.5" />
                          查看话术
                        </Button>
                      )}
                      {task.status !== 'contacted' && (
                        <Button size="sm" disabled={updating} onClick={() => void markOutreachTask(task.id, 'contacted', '已标记为已触达')}>
                          <PhoneOutgoing className="mr-1 h-3.5 w-3.5" />已触达
                        </Button>
                      )}
                      {task.status !== 'replied' && (
                        <Button size="sm" disabled={updating} onClick={() => void markOutreachTask(task.id, 'replied', '已标记为已回复')}>
                          <MessageSquareReply className="mr-1 h-3.5 w-3.5" />已回复
                        </Button>
                      )}
                      {task.status !== 'no_response' && (
                        <Button size="sm" disabled={updating} onClick={() => void markOutreachTask(task.id, 'no_response', '已标记为未响应')}>
                          未响应
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <Card className="border-slate-200 shadow-none">
          <CardHeader><CardTitle>记录真实结果</CardTitle><CardDescription>每次保存都会形成一条不可直接修改的事件记录。</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="outcome-match">候选人与职位</Label>
              <Select value={matchId} onValueChange={setMatchId} disabled={loading}>
                <SelectTrigger id="outcome-match" className="w-full"><SelectValue placeholder={loading ? '加载中…' : '选择候选人与职位'} /></SelectTrigger>
                <SelectContent>{matchRecords.map((record) => <SelectItem key={record.id} value={record.id}>{record.candidate?.name || '候选人'} · {record.job?.title || '职位'} · {STATUS_LABELS[record.status] || record.status}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="outcome-event">发生了什么</Label>
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger id="outcome-event" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{OUTCOME_GROUPS.flatMap((group) => group.options.map(([value, label]) => <SelectItem key={value} value={value}>{group.label} · {label}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label htmlFor="outcome-time">发生时间</Label><Input id="outcome-time" type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></div>
            {needsReason && <div className="space-y-2"><Label htmlFor="outcome-reason">{reasonLabel}</Label><Input id="outcome-reason" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} placeholder={eventType === 'rejected' ? '例如：岗位关键条件不符合' : eventType === 'withdrawn' ? '例如：候选人接受其他机会' : '例如：联系频率或数据处理'} maxLength={100} /></div>}
            {eventType === 'interview_scheduled' && (
              <div className="space-y-3 rounded-lg border border-slate-200 p-3">
                <div className="space-y-2"><Label htmlFor="interview-scheduled-at">面试时间</Label><Input id="interview-scheduled-at" type="datetime-local" value={interviewScheduledAt} onChange={(event) => setInterviewScheduledAt(event.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="interview-method">面试方式</Label><Select value={interviewMethod} onValueChange={setInterviewMethod}><SelectTrigger id="interview-method" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="现场">现场</SelectItem><SelectItem value="视频">视频</SelectItem><SelectItem value="电话">电话</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label htmlFor="interview-interviewers">面试官（逗号分隔）</Label><Input id="interview-interviewers" value={interviewers} onChange={(event) => setInterviewers(event.target.value)} placeholder="例如：王经理, 李主管" /></div>
              </div>
            )}
            {eventType === 'interview_feedback' && (
              <div className="space-y-3 rounded-lg border border-slate-200 p-3">
                <div className="space-y-2"><Label htmlFor="feedback-verdict">面试结论</Label><Select value={feedbackVerdict} onValueChange={setFeedbackVerdict}><SelectTrigger id="feedback-verdict" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pass">通过</SelectItem><SelectItem value="fail">不通过</SelectItem><SelectItem value="hold">待定</SelectItem></SelectContent></Select></div>
                <div className="space-y-2">
                  <Label htmlFor="feedback-guide">关联面试提纲（可选）</Label>
                  <Select value={feedbackGuideId} onValueChange={handleGuideSelect}>
                    <SelectTrigger id="feedback-guide" className="w-full"><SelectValue placeholder={availableGuides.length === 0 ? '该候选人暂无已生成提纲' : '不关联'} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不关联</SelectItem>
                      {availableGuides.map((guide) => <SelectItem key={guide.id} value={guide.id}>{guideOptionLabel(guide)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-5 text-slate-500">关联后可按提纲逐题记录命中情况，供评分校准参考。</p>
                </div>
                {selectedGuide && (
                  <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                    <Label>专项题命中情况（选填）</Label>
                    {selectedGuide.targeted_questions.filter((item) => item.question && item.origin).map((item) => {
                      const question = item.question as string;
                      const rating = questionRatings[question] ?? 'skipped';
                      return (
                        <div key={question} className="space-y-1.5">
                          <p className="text-sm leading-6 text-slate-700">{question}</p>
                          <RadioGroup
                            value={rating}
                            onValueChange={(value) => setQuestionRatings((previous) => ({ ...previous, [question]: value as 'hit' | 'miss' | 'skipped' }))}
                            className="flex gap-4"
                            aria-label={`题目「${question}」命中情况`}
                          >
                            {([['hit', '命中'], ['miss', '未命中'], ['skipped', '未考察']] as const).map(([value, label]) => (
                              <label key={value} className="flex items-center gap-1.5 text-sm text-slate-600">
                                <RadioGroupItem value={value} />
                                {label}
                              </label>
                            ))}
                          </RadioGroup>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="space-y-2"><Label htmlFor="feedback-summary">反馈摘要</Label><Textarea id="feedback-summary" value={feedbackSummary} onChange={(event) => setFeedbackSummary(event.target.value)} placeholder="记录面试关键事实与结论依据" maxLength={2000} /></div>
              </div>
            )}
            {eventType === 'offer_details' && (
              <div className="space-y-3 rounded-lg border border-slate-200 p-3">
                <div className="space-y-2"><Label htmlFor="offer-compensation">薪酬说明</Label><Input id="offer-compensation" value={compensationNote} onChange={(event) => setCompensationNote(event.target.value)} placeholder="例如：月薪 20-25K，14 薪" maxLength={2000} /></div>
                <div className="space-y-2"><Label htmlFor="offer-approval">审批说明</Label><Input id="offer-approval" value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} placeholder="例如：已通过用人部门负责人审批" maxLength={2000} /></div>
              </div>
            )}
            <div className="space-y-2"><Label htmlFor="outcome-note">补充说明</Label><Textarea id="outcome-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="只记录必要的业务事实，避免写入额外敏感信息" maxLength={2000} /></div>
            <div className="space-y-2">
              <Label htmlFor="outcome-writeback">ATS 回写</Label>
              <Select value={writebackConnectionId} onValueChange={setWritebackConnectionId}>
                <SelectTrigger id="outcome-writeback" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">仅记录在本系统，不对外写回</SelectItem>
                  {outboundConnections.map(connection => <SelectItem key={connection.id} value={connection.id}>同步到 {connection.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {writebackConnectionId !== 'none' && <p className="text-xs leading-5 text-amber-700">确认后会原子创建回写意图；外部调用由受限 Worker 异步执行，可审计、重试或取消。</p>}
            </div>
            <Button onClick={() => void recordOutcome()} disabled={saving || !matchId} className="w-full sm:w-auto"><CheckCircle2 className="mr-2 h-4 w-4" />{saving ? '记录中…' : writebackConnectionId === 'none' ? '确认并记录结果' : '确认结果并批准回写'}</Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-slate-200 shadow-none">
            <CardHeader><CardTitle className="text-base">当前候选人进展</CardTitle><CardDescription>这是事件汇总后的当前状态，不会被较早事件倒退。</CardDescription></CardHeader>
            <CardContent>
              {selectedMatch ? <div className="space-y-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-800">{selectedMatch.candidate?.name?.[0] || '?'}</div><div><p className="font-medium text-slate-950">{selectedMatch.candidate?.name || '候选人'}</p><p className="text-sm text-slate-500">{selectedMatch.job?.title || '职位'}</p></div></div><Badge className="bg-slate-900 text-white">{STATUS_LABELS[selectedMatch.status] || selectedMatch.status}</Badge>{latestInterviewText && <div className="flex items-center gap-2 text-sm text-slate-600"><CalendarClock className="h-4 w-4 shrink-0 text-blue-600" /><span>最近面试安排：{latestInterviewText}</span></div>}</div> : <p className="text-sm text-slate-500">选择候选人后查看当前招聘状态。</p>}
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-none">
            <CardHeader><CardTitle className="text-base">结果事件如何进入指标</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <div className="flex gap-3"><PhoneOutgoing className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><p>触达 → 回复：计算触达回复率</p></div>
              <div className="flex gap-3"><MessageSquareReply className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><p>回复 → 安排面试：计算面试转化率</p></div>
              <div className="flex gap-3"><CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><p>合格面试 → Offer：计算 Offer 转化率</p></div>
              <div className="flex gap-3"><Handshake className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><p>Offer → 录用：计算录用转化率</p></div>
              <div className="flex gap-3"><UserRoundX className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><p>撤回与投诉：进入候选人体验指标</p></div>
            </CardContent>
          </Card>
          <Card className="border-amber-200 bg-amber-50 shadow-none">
            <CardContent className="flex gap-3 pt-0"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div><p className="font-medium text-amber-950">发现记录错误？</p><p className="mt-1 text-sm leading-5 text-amber-800">不要覆盖历史。请联系管理员追加“阶段更正”事件，以保留审计链。</p></div></CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={scriptDialogOpen} onOpenChange={setScriptDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>沟通话术</DialogTitle>
            <DialogDescription>
              {scriptTask ? `${scriptTask.candidate_name} · ${scriptTask.job_title}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-700">
            {scriptTask?.script_snapshot || '暂无话术内容'}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
