'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlarmClock,
  ArrowRight,
  CheckCircle2,
  Clock3,
  MessageCircleReply,
  RefreshCw,
  ShieldAlert,
  UserCheck,
  UserRoundCheck,
  UsersRound,
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
import { authFetch } from '@/lib/auth-client';
import { useWorkspaceData } from '../hooks/use-workspace-data';

interface CountRate {
  value: number | null;
  numerator: number;
  denominator: number;
  unresolved?: number;
}

interface DecisionMetrics {
  period: { from: string; to: string; as_of: string; timezone: string };
  qualified_interviews_per_recruiter_week: {
    value: number | null;
    qualified_interviews: number;
    active_recruiter_weeks: number;
  };
  time_to_first_qualified_shortlist: {
    p50_minutes: number | null;
    p90_minutes: number | null;
    sample_size: number;
    incomplete_jobs: number;
  };
  recommendation_acceptance: CountRate;
  human_override: CountRate & { reasons: Record<string, number> };
  outreach_reply: CountRate;
  interview_conversion: CountRate;
  offer_conversion: CountRate;
  hire_conversion: CountRate;
  withdrawal: CountRate;
  complaint: CountRate;
  compliance: {
    rights_request_overdue_rate: number | null;
    overdue_requests: number;
    rights_request_sample_size: number;
    expired_authorization_active_processing_count: number;
  };
  processed_candidate_sample_size: number;
  recent_events?: Array<{
    id: string;
    category: 'outcome' | 'decision';
    event_type: string;
    analytics_subject_id: string;
    job_id: string;
    department: string | null;
    occurred_at: string;
  }>;
}

const REASON_LABELS: Record<string, string> = {
  missing_context: '缺少业务背景',
  business_constraint: '业务约束',
  incorrect_evidence: '证据不准确',
  stale_data: '数据已过期',
  candidate_preference: '候选人意愿',
  other: '其他',
  unspecified: '未说明',
};

const EVENT_LABELS: Record<string, string> = {
  accepted: '人工接受推荐', needs_information: '要求补充信息', overridden: '人工覆盖推荐',
  outreach_sent: '已触达', candidate_replied: '候选人回复', interview_scheduled: '安排面试',
  interview_completed: '完成面试', qualified_interview: '合格面试', offer: '发出 Offer',
  hired: '录用', rejected: '人工拒绝', withdrawn: '候选人撤回', complaint: '投诉',
  stage_corrected: '管理员阶段更正',
};

function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function zonedMidnight(date: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day);
  let instant = target;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(
      parts.find(item => item.type === type)?.value,
    );
    const representedAsUtc = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
    );
    instant = target - (representedAsUtc - instant);
  }
  return new Date(instant).toISOString();
}

function percent(value: number | null): string {
  return value === null ? '待积累' : `${value}%`;
}

function duration(minutes: number | null): string {
  if (minutes === null) return '待积累';
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  return `${Math.round((minutes / 60) * 10) / 10} 小时`;
}

function RateCard({
  title,
  description,
  metric,
  icon,
}: {
  title: string;
  description: string;
  metric: CountRate;
  icon: React.ReactNode;
}) {
  return (
    <Card className="gap-4 border-slate-200 shadow-none">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-sm font-medium text-slate-600">{title}</CardTitle>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{percent(metric.value)}</p>
          </div>
          <div className="rounded-lg bg-blue-50 p-2 text-blue-700" aria-hidden="true">{icon}</div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs leading-5 text-slate-500">{description}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
          <Badge variant="outline">转化 {metric.numerator}</Badge>
          <Badge variant="outline">样本 {metric.denominator}</Badge>
          {typeof metric.unresolved === 'number' && <Badge variant="outline">仍在观察 {metric.unresolved}</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}

export function AnalyticsWorkspace() {
  const { jobs } = useWorkspaceData();
  const [from, setFrom] = useState(() => dateInputValue(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => dateInputValue(new Date()));
  const [jobId, setJobId] = useState('all');
  const [metrics, setMetrics] = useState<DecisionMetrics | null>(null);
  const [timeZone, setTimeZone] = useState('Asia/Shanghai');
  const [loading, setLoading] = useState(true);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: zonedMidnight(from, timeZone),
        to: zonedMidnight(addUtcDays(to, 1), timeZone),
      });
      if (jobId !== 'all') params.set('jobId', jobId);
      const response = await authFetch(`/api/decision-metrics?${params.toString()}`);
      const result: { success?: boolean; data?: DecisionMetrics; error?: string } = await response.json();
      if (!response.ok || !result.success || !result.data) throw new Error(result.error || '决策指标加载失败');
      setMetrics(result.data);
      setTimeZone(result.data.period.timezone);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '决策指标加载失败');
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  }, [from, jobId, timeZone, to]);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const overrideReasons = useMemo(
    () => Object.entries(metrics?.human_override.reasons ?? {}).sort((left, right) => right[1] - left[1]),
    [metrics],
  );

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 text-white">
        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Decision evidence</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">用招聘结果校准判断，而不是追逐模型平均分</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              每项指标都来自人工决策与真实招聘事件。展开样本和分母，判断数据是否足以支持下一步行动。
            </p>
          </div>
          <Badge className="w-fit border-slate-600 bg-slate-900 text-slate-200 hover:bg-slate-900">
            {metrics?.processed_candidate_sample_size ?? 0} 位候选人样本
          </Badge>
        </div>
        <div className="h-1 bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400" />
      </section>

      <Card className="gap-4 border-slate-200 shadow-none">
        <CardContent className="grid gap-4 pt-0 md:grid-cols-[1fr_1fr_1.5fr_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="metrics-from">开始日期</Label>
            <Input id="metrics-from" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="metrics-to">结束日期</Label>
            <Input id="metrics-to" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="metrics-job">职位</Label>
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger id="metrics-job" className="w-full"><SelectValue placeholder="全部职位" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部职位</SelectItem>
                {jobs.map((job) => <SelectItem key={job.id} value={job.id}>{job.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => void loadMetrics()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新指标
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-48 rounded-xl" />)}</div>
      ) : !metrics ? (
        <Alert><ShieldAlert className="h-4 w-4" /><AlertTitle>暂时无法读取决策数据</AlertTitle><AlertDescription>检查数据源连接后重试。历史模型分数不会作为替代指标显示。</AlertDescription></Alert>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="gap-4 border-blue-200 bg-blue-50/60 shadow-none">
              <CardHeader className="pb-0"><CardDescription>每位招聘者每周</CardDescription><CardTitle className="text-3xl text-slate-950">{metrics.qualified_interviews_per_recruiter_week.value ?? '待积累'}</CardTitle></CardHeader>
              <CardContent><p className="text-sm font-medium text-slate-700">合格面试数</p><p className="mt-2 text-xs text-slate-500">{metrics.qualified_interviews_per_recruiter_week.qualified_interviews} 次合格面试 / {metrics.qualified_interviews_per_recruiter_week.active_recruiter_weeks} 个活跃招聘者周</p></CardContent>
            </Card>
            <Card className="gap-4 border-slate-200 shadow-none">
              <CardHeader className="pb-0"><CardDescription>首份合格短名单耗时</CardDescription><CardTitle className="text-3xl text-slate-950">{duration(metrics.time_to_first_qualified_shortlist.p50_minutes)}</CardTitle></CardHeader>
              <CardContent><p className="text-xs text-slate-500">P90 {duration(metrics.time_to_first_qualified_shortlist.p90_minutes)} · 样本 {metrics.time_to_first_qualified_shortlist.sample_size}</p></CardContent>
            </Card>
            <Card className="gap-4 border-slate-200 shadow-none">
              <CardHeader className="pb-0"><CardDescription>尚未产出合格短名单</CardDescription><CardTitle className="text-3xl text-slate-950">{metrics.time_to_first_qualified_shortlist.incomplete_jobs}</CardTitle></CardHeader>
              <CardContent><p className="text-xs text-slate-500">已发起生成、但尚未被 HR 确认为合格的职位</p></CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <RateCard title="AI 推荐接受率" description="最新人工结论为接受的短名单条目" metric={metrics.recommendation_acceptance} icon={<UserCheck className="h-5 w-5" />} />
            <RateCard title="人工覆盖率" description="人工不同意当前推荐优先级的比例" metric={metrics.human_override} icon={<UsersRound className="h-5 w-5" />} />
            <RateCard title="触达回复率" description="本期触达后、观察期内获得回复" metric={metrics.outreach_reply} icon={<MessageCircleReply className="h-5 w-5" />} />
            <RateCard title="面试转化率" description="本期回复后、观察期内安排面试" metric={metrics.interview_conversion} icon={<UserRoundCheck className="h-5 w-5" />} />
            <RateCard title="Offer 转化率" description="本期合格面试后、观察期内发出 Offer" metric={metrics.offer_conversion} icon={<CheckCircle2 className="h-5 w-5" />} />
            <RateCard title="录用转化率" description="本期 Offer 后、观察期内完成录用" metric={metrics.hire_conversion} icon={<ArrowRight className="h-5 w-5" />} />
            <RateCard title="候选人撤回率" description="处理候选人中产生撤回事件的比例" metric={metrics.withdrawal} icon={<Clock3 className="h-5 w-5" />} />
            <RateCard title="投诉率" description="处理候选人中产生投诉事件的比例" metric={metrics.complaint} icon={<ShieldAlert className="h-5 w-5" />} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-slate-200 shadow-none">
              <CardHeader><CardTitle className="text-base">人工覆盖原因</CardTitle><CardDescription>仅汇总最新有效人工结论，不展示候选人敏感信息</CardDescription></CardHeader>
              <CardContent>
                {overrideReasons.length === 0 ? <p className="text-sm text-slate-500">本期没有人工覆盖记录。</p> : (
                  <div className="space-y-3">{overrideReasons.map(([reason, count]) => (
                    <div key={reason} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0"><span className="text-sm text-slate-700">{REASON_LABELS[reason] ?? reason}</span><Badge variant="secondary">{count}</Badge></div>
                  ))}</div>
                )}
              </CardContent>
            </Card>
            <Card className="border-slate-200 shadow-none">
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlarmClock className="h-4 w-4 text-amber-600" />数据处理边界</CardTitle><CardDescription>需人工介入的隐私与授权信号</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between rounded-lg bg-amber-50 px-4 py-3"><span className="text-sm text-amber-900">权利请求超期率</span><strong className="text-amber-950">{percent(metrics.compliance.rights_request_overdue_rate)}</strong></div>
                <div className="flex items-center justify-between rounded-lg bg-red-50 px-4 py-3"><span className="text-sm text-red-900">已过期授权仍在处理中</span><strong className="text-red-950">{metrics.compliance.expired_authorization_active_processing_count}</strong></div>
                <p className="text-xs leading-5 text-slate-500">权利请求样本 {metrics.compliance.rights_request_sample_size}，其中超期 {metrics.compliance.overdue_requests}。</p>
              </CardContent>
            </Card>
          </div>
          <Card className="border-slate-200 shadow-none">
            <CardHeader><CardTitle className="text-base">可追溯事件</CardTitle><CardDescription>仅展示随机分析主体与业务事件，不包含姓名、联系方式或简历正文。</CardDescription></CardHeader>
            <CardContent>
              {(metrics.recent_events ?? []).length === 0 ? <p className="text-sm text-slate-500">本期尚无可追溯事件。</p> : (
                <div className="divide-y divide-slate-100">{(metrics.recent_events ?? []).map((event) => (
                  <div key={`${event.category}-${event.id}`} className="grid gap-2 py-3 text-sm md:grid-cols-[auto_1fr_auto] md:items-center">
                    <Badge variant="outline">{event.category === 'decision' ? '人工决策' : '招聘结果'}</Badge>
                    <div><p className="font-medium text-slate-800">{EVENT_LABELS[event.event_type] ?? event.event_type}</p><p className="mt-1 text-xs text-slate-500">分析主体 {event.analytics_subject_id.slice(0, 8)} · {jobs.find((job) => job.id === event.job_id)?.title ?? event.department ?? '职位'}</p></div>
                    <time className="text-xs text-slate-500">{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.occurred_at))}</time>
                  </div>
                ))}</div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
