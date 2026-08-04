'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck,
  CheckCircle2,
  CircleAlert,
  Handshake,
  MessageSquareReply,
  PhoneOutgoing,
  ShieldAlert,
  UserRoundX,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
      ['interview_completed', '已完成面试'],
      ['qualified_interview', '合格面试'],
    ],
  },
  {
    label: '后续结果',
    options: [
      ['offer', '已发 Offer'],
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

  const selectedMatch = useMemo(() => matchRecords.find((record) => record.id === matchId) ?? null, [matchId, matchRecords]);
  const reasonLabel = outcomeReasonLabel(eventType);
  const needsReason = reasonLabel !== null;

  async function recordOutcome() {
    if (!matchId) {
      toast.error('请选择候选人与职位');
      return;
    }
    if (needsReason && !reasonCode.trim()) {
      toast.error(eventType === 'rejected' ? '人工拒绝必须填写原因' : '请填写投诉分类');
      return;
    }
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
      await Promise.all([reloadMatchRecords(), reloadDashboard()]);
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
              {selectedMatch ? <div className="space-y-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-800">{selectedMatch.candidate?.name?.[0] || '?'}</div><div><p className="font-medium text-slate-950">{selectedMatch.candidate?.name || '候选人'}</p><p className="text-sm text-slate-500">{selectedMatch.job?.title || '职位'}</p></div></div><Badge className="bg-slate-900 text-white">{STATUS_LABELS[selectedMatch.status] || selectedMatch.status}</Badge></div> : <p className="text-sm text-slate-500">选择候选人后查看当前招聘状态。</p>}
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
    </div>
  );
}
