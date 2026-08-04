import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenantRequestContext } from '@/lib/auth-server';
import { apiErrorResponse } from '@/lib/api-response';
import { calculateDecisionMetrics } from '@/lib/metrics/decision-metrics';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const querySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  asOf: z.string().datetime({ offset: true }).optional(),
  recruiterId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  department: z.string().trim().min(1).max(100).optional(),
}).strict();

type OutcomeRow = Parameters<typeof calculateDecisionMetrics>[0]['outcomes'][number];
type DecisionRow = Parameters<typeof calculateDecisionMetrics>[0]['decisions'][number];
type ShortlistRunRow = Parameters<typeof calculateDecisionMetrics>[0]['shortlist_runs'][number];
type JobRow = Parameters<typeof calculateDecisionMetrics>[0]['jobs'][number];
type RightsRow = Parameters<typeof calculateDecisionMetrics>[0]['rights_requests'][number];
type QueryError = { message: string };
type PageResult<T> = { data: T[] | null; error: QueryError | null };

const METRIC_PAGE_SIZE = 1000;
const METRIC_ROW_HARD_LIMIT = 100_000;

async function fetchAllMetricRows<T>(
  loadPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  while (true) {
    const result = await loadPage(rows.length, rows.length + METRIC_PAGE_SIZE - 1);
    if (result.error) throw new Error(result.error.message);
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < METRIC_PAGE_SIZE) return rows;
    if (rows.length >= METRIC_ROW_HARD_LIMIT) {
      throw new Error('指标事件超过单次查询上限，请缩小日期范围');
    }
  }
}

function parsePeriod(request: NextRequest) {
  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) throw new Error('指标筛选条件无效');
  const to = parsed.data.to ?? new Date().toISOString();
  const from = parsed.data.from ?? new Date(Date.parse(to) - 30 * 24 * 60 * 60 * 1000).toISOString();
  const asOf = parsed.data.asOf ?? to;
  if (Date.parse(from) >= Date.parse(to) || Date.parse(asOf) < Date.parse(to)) {
    throw new Error('指标时间范围无效');
  }
  return { ...parsed.data, from, to, asOf };
}

export async function GET(request: NextRequest) {
  try {
    const period = parsePeriod(request);
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.dashboard);

    const { data: organization, error: organizationError } = await supabase
      .from('organizations')
      .select('timezone, metrics_enabled_at')
      .eq('id', user.organizationId)
      .single();
    if (organizationError || !organization) throw new Error('无法读取组织指标配置');

    const metricsStart = new Date(Math.max(
      Date.parse(period.from),
      Date.parse(organization.metrics_enabled_at || period.from),
    )).toISOString();

    const [outcomes, decisions, shortlistRuns, jobs, rightsRequests, expiredResult] = await Promise.all([
      fetchAllMetricRows<OutcomeRow>((from, to) => supabase
        .from('recruiting_outcome_events')
        .select('id, analytics_subject_id, job_id_snapshot, recruiter_user_id_snapshot, department_snapshot, event_type, occurred_at, recorded_at, supersedes_event_id')
        .eq('organization_id', user.organizationId)
        .gte('occurred_at', metricsStart)
        .lt('occurred_at', period.asOf)
        .order('occurred_at', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PageResult<OutcomeRow>>),
      fetchAllMetricRows<DecisionRow>((from, to) => supabase
        .from('recommendation_decision_events')
        .select('id, shortlist_entry_id, analytics_subject_id, job_id_snapshot, recruiter_user_id_snapshot, department_snapshot, decision, reason_code, occurred_at, recorded_at')
        .eq('organization_id', user.organizationId)
        .gte('occurred_at', metricsStart)
        .lt('occurred_at', period.asOf)
        .order('occurred_at', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PageResult<DecisionRow>>),
      fetchAllMetricRows<ShortlistRunRow>((from, to) => supabase
        .from('shortlist_runs')
        .select('id, job_id, requested_at, qualified_at')
        .eq('organization_id', user.organizationId)
        .gte('requested_at', metricsStart)
        .lt('requested_at', period.to)
        .order('requested_at', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PageResult<ShortlistRunRow>>),
      fetchAllMetricRows<JobRow>((from, to) => supabase
        .from('job_requirements')
        .select('id, owner_user_id, department, activated_at, closed_at')
        .eq('organization_id', user.organizationId)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PageResult<JobRow>>),
      fetchAllMetricRows<RightsRow>((from, to) => supabase
        .from('candidate_rights_requests')
        .select('status, due_at, resolved_at')
        .eq('organization_id', user.organizationId)
        .gte('due_at', metricsStart)
        .lt('due_at', period.to)
        .order('due_at', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PageResult<RightsRow>>),
      supabase.rpc('count_expired_authorization_active_processing', {
        p_as_of: period.asOf,
      }),
    ]);

    if (expiredResult.error) {
      throw new Error(`决策指标查询失败: ${expiredResult.error.message}`);
    }

    const data = calculateDecisionMetrics({
      from: metricsStart,
      to: period.to,
      as_of: period.asOf,
      timezone: organization.timezone || 'Asia/Shanghai',
      outcomes,
      decisions,
      shortlist_runs: shortlistRuns,
      jobs,
      rights_requests: rightsRequests,
      expired_authorization_active_processing_count: Number(expiredResult.data ?? 0),
      filters: {
        recruiter_id: period.recruiterId,
        job_id: period.jobId,
        department: period.department,
      },
    });

    const supersededIds = new Set(outcomes
      .map(event => event.supersedes_event_id).filter((id): id is string => Boolean(id)));
    const matchesFilter = (row: {
      job_id_snapshot: string;
      recruiter_user_id_snapshot: string | null;
      department_snapshot: string | null;
    }) => (
      (!period.jobId || row.job_id_snapshot === period.jobId)
      && (!period.recruiterId || row.recruiter_user_id_snapshot === period.recruiterId)
      && (!period.department || row.department_snapshot === period.department)
    );
    const recentEvents = [
      ...outcomes
        .filter(event => !supersededIds.has(event.id) && matchesFilter(event))
        .map(event => ({
          id: event.id,
          category: 'outcome' as const,
          event_type: event.event_type,
          analytics_subject_id: event.analytics_subject_id,
          job_id: event.job_id_snapshot,
          department: event.department_snapshot,
          occurred_at: event.occurred_at,
        })),
      ...decisions
        .filter(matchesFilter)
        .map(event => ({
          id: event.id,
          category: 'decision' as const,
          event_type: event.decision,
          analytics_subject_id: event.analytics_subject_id,
          job_id: event.job_id_snapshot,
          department: event.department_snapshot,
          occurred_at: event.occurred_at,
        })),
    ].sort((left, right) => right.occurred_at.localeCompare(left.occurred_at)).slice(0, 25);

    return NextResponse.json({ success: true, data: { ...data, recent_events: recentEvents } });
  } catch (error) {
    return apiErrorResponse(error, '获取决策指标失败');
  }
}
