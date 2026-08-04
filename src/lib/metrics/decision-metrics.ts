export type OutcomeEventType =
  | 'outreach_sent'
  | 'candidate_replied'
  | 'interview_scheduled'
  | 'interview_completed'
  | 'qualified_interview'
  | 'offer'
  | 'hired'
  | 'rejected'
  | 'withdrawn'
  | 'complaint'
  | 'stage_corrected';

export interface MetricOutcomeEvent {
  id: string;
  analytics_subject_id: string;
  job_id_snapshot: string;
  recruiter_user_id_snapshot: string | null;
  department_snapshot: string | null;
  event_type: OutcomeEventType;
  occurred_at: string;
  recorded_at: string;
  supersedes_event_id: string | null;
}

export interface MetricDecisionEvent {
  id: string;
  shortlist_entry_id: string | null;
  analytics_subject_id: string;
  job_id_snapshot: string;
  recruiter_user_id_snapshot: string | null;
  department_snapshot: string | null;
  decision: 'accepted' | 'needs_information' | 'overridden';
  reason_code: string | null;
  occurred_at: string;
  recorded_at: string;
}

export interface MetricShortlistRun {
  id: string;
  job_id: string;
  requested_at: string;
  qualified_at: string | null;
}

export interface MetricJob {
  id: string;
  owner_user_id: string | null;
  department: string | null;
  activated_at: string | null;
  closed_at: string | null;
}

export interface MetricRightsRequest {
  status: string;
  due_at: string;
  resolved_at: string | null;
}

export interface DecisionMetricFilters {
  recruiter_id?: string;
  job_id?: string;
  department?: string;
}

export interface DecisionMetricsInput {
  from: string;
  to: string;
  as_of: string;
  timezone: string;
  outcomes: MetricOutcomeEvent[];
  decisions: MetricDecisionEvent[];
  shortlist_runs: MetricShortlistRun[];
  jobs: MetricJob[];
  rights_requests: MetricRightsRequest[];
  expired_authorization_active_processing_count: number;
  filters?: DecisionMetricFilters;
}

interface RateMetric {
  value: number | null;
  numerator: number;
  denominator: number;
  unresolved: number;
}

function inPeriod(value: string, from: number, to: number): boolean {
  const time = Date.parse(value);
  return time >= from && time < to;
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(ordered.length * fraction) - 1);
  return Math.round(ordered[index]);
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10;
}

function subjectJobKey(event: Pick<MetricOutcomeEvent, 'analytics_subject_id' | 'job_id_snapshot'>): string {
  return `${event.analytics_subject_id}:${event.job_id_snapshot}`;
}

function later(left: { occurred_at: string; recorded_at: string; id: string }, right: typeof left): boolean {
  return [left.occurred_at, left.recorded_at, left.id].join('\u0000')
    > [right.occurred_at, right.recorded_at, right.id].join('\u0000');
}

function applyFilters<T extends {
  job_id_snapshot: string;
  recruiter_user_id_snapshot: string | null;
  department_snapshot: string | null;
}>(rows: T[], filters: DecisionMetricFilters): T[] {
  return rows.filter(row => (
    (!filters.job_id || row.job_id_snapshot === filters.job_id)
    && (!filters.recruiter_id || row.recruiter_user_id_snapshot === filters.recruiter_id)
    && (!filters.department || row.department_snapshot === filters.department)
  ));
}

function conversionRate(
  outcomes: MetricOutcomeEvent[],
  denominatorType: OutcomeEventType,
  numeratorType: OutcomeEventType,
  from: number,
  to: number,
  asOf: number,
): RateMetric {
  const cohort = new Map<string, MetricOutcomeEvent>();
  for (const event of outcomes) {
    if (event.event_type !== denominatorType || !inPeriod(event.occurred_at, from, to)) continue;
    const key = subjectJobKey(event);
    const previous = cohort.get(key);
    if (!previous || Date.parse(event.occurred_at) < Date.parse(previous.occurred_at)) cohort.set(key, event);
  }

  let numerator = 0;
  for (const [key, denominator] of cohort) {
    const denominatorAt = Date.parse(denominator.occurred_at);
    if (outcomes.some(event => (
      subjectJobKey(event) === key
      && event.event_type === numeratorType
      && Date.parse(event.occurred_at) >= denominatorAt
      && Date.parse(event.occurred_at) < asOf
    ))) numerator += 1;
  }
  const denominator = cohort.size;
  return {
    value: ratio(numerator, denominator),
    numerator,
    denominator,
    unresolved: denominator - numerator,
  };
}

function mondayKey(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  const localDate = new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
  const weekday = localDate.getUTCDay();
  localDate.setUTCDate(localDate.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return localDate.toISOString().slice(0, 10);
}

function activeRecruiterWeeks(jobs: MetricJob[], from: number, to: number, timezone: string): number {
  const keys = new Set<string>();
  for (const job of jobs) {
    if (!job.owner_user_id || !job.activated_at) continue;
    const start = Math.max(from, Date.parse(job.activated_at));
    const end = Math.min(to, job.closed_at ? Date.parse(job.closed_at) : to);
    for (let cursor = start; cursor < end; cursor += 7 * 24 * 60 * 60 * 1000) {
      keys.add(`${job.owner_user_id}:${mondayKey(new Date(cursor).toISOString(), timezone)}`);
    }
    if (end > start) keys.add(`${job.owner_user_id}:${mondayKey(new Date(end - 1).toISOString(), timezone)}`);
  }
  return keys.size;
}

export function calculateDecisionMetrics(input: DecisionMetricsInput) {
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  const asOf = Date.parse(input.as_of);
  if (![from, to, asOf].every(Number.isFinite) || from >= to || asOf < to) {
    throw new Error('invalid metrics period');
  }

  const filters = input.filters ?? {};
  const superseded = new Set(input.outcomes.map(event => event.supersedes_event_id).filter(Boolean));
  const outcomes = applyFilters(
    input.outcomes.filter(event => !superseded.has(event.id) && Date.parse(event.occurred_at) < asOf),
    filters,
  );
  const decisions = applyFilters(input.decisions, filters);

  const latestDecisions = new Map<string, MetricDecisionEvent>();
  for (const event of decisions) {
    if (!event.shortlist_entry_id) continue;
    const previous = latestDecisions.get(event.shortlist_entry_id);
    if (!previous || later(event, previous)) latestDecisions.set(event.shortlist_entry_id, event);
  }
  const reviewed = [...latestDecisions.values()].filter(event => inPeriod(event.occurred_at, from, to));
  const accepted = reviewed.filter(event => event.decision === 'accepted').length;
  const overridden = reviewed.filter(event => event.decision === 'overridden');
  const overrideReasons = Object.fromEntries(
    [...new Set(overridden.map(event => event.reason_code ?? 'unspecified'))]
      .map(reason => [reason, overridden.filter(event => (event.reason_code ?? 'unspecified') === reason).length]),
  );

  const jobFilter = new Set(input.jobs.filter(job => (
    (!filters.job_id || job.id === filters.job_id)
    && (!filters.recruiter_id || job.owner_user_id === filters.recruiter_id)
    && (!filters.department || job.department === filters.department)
  )).map(job => job.id));
  const shortlistRuns = input.shortlist_runs.filter(run => jobFilter.has(run.job_id));
  const firstQualifiedByJob = new Map<string, MetricShortlistRun>();
  for (const run of shortlistRuns) {
    if (!run.qualified_at || !inPeriod(run.requested_at, from, to)) continue;
    const previous = firstQualifiedByJob.get(run.job_id);
    if (!previous || Date.parse(run.qualified_at) < Date.parse(previous.qualified_at ?? '')) {
      firstQualifiedByJob.set(run.job_id, run);
    }
  }
  const shortlistMinutes = [...firstQualifiedByJob.values()].map(run => (
    (Date.parse(run.qualified_at ?? run.requested_at) - Date.parse(run.requested_at)) / 60_000
  ));
  const requestedJobs = new Set(shortlistRuns.filter(run => inPeriod(run.requested_at, from, to)).map(run => run.job_id));

  const processedSubjects = new Set<string>();
  for (const event of outcomes) if (inPeriod(event.occurred_at, from, to)) processedSubjects.add(event.analytics_subject_id);
  for (const event of reviewed) processedSubjects.add(event.analytics_subject_id);
  const qualifiedInterviews = new Set(outcomes
    .filter(event => event.event_type === 'qualified_interview' && inPeriod(event.occurred_at, from, to))
    .map(subjectJobKey)).size;
  const recruiterWeeks = activeRecruiterWeeks(
    input.jobs.filter(job => jobFilter.has(job.id)),
    from,
    to,
    input.timezone,
  );

  const outreachReply = conversionRate(outcomes, 'outreach_sent', 'candidate_replied', from, to, asOf);
  const replyInterview = conversionRate(outcomes, 'candidate_replied', 'interview_scheduled', from, to, asOf);
  const interviewOffer = conversionRate(outcomes, 'qualified_interview', 'offer', from, to, asOf);
  const offerHire = conversionRate(outcomes, 'offer', 'hired', from, to, asOf);
  const withdrawals = new Set(outcomes.filter(event => event.event_type === 'withdrawn' && inPeriod(event.occurred_at, from, to)).map(event => event.analytics_subject_id)).size;
  const complaints = new Set(outcomes.filter(event => event.event_type === 'complaint' && inPeriod(event.occurred_at, from, to)).map(event => event.analytics_subject_id)).size;
  const rights = input.rights_requests.filter(request => inPeriod(request.due_at, from, to));
  const overdue = rights.filter(request => (
    Date.parse(request.due_at) < asOf
    && (request.status !== 'resolved' || !request.resolved_at || Date.parse(request.resolved_at) > Date.parse(request.due_at))
  )).length;

  return {
    period: { from: input.from, to: input.to, as_of: input.as_of, timezone: input.timezone },
    qualified_interviews_per_recruiter_week: {
      value: recruiterWeeks === 0 ? null : Math.round((qualifiedInterviews / recruiterWeeks) * 100) / 100,
      qualified_interviews: qualifiedInterviews,
      active_recruiter_weeks: recruiterWeeks,
    },
    time_to_first_qualified_shortlist: {
      p50_minutes: percentile(shortlistMinutes, 0.5),
      p90_minutes: percentile(shortlistMinutes, 0.9),
      sample_size: shortlistMinutes.length,
      incomplete_jobs: [...requestedJobs].filter(jobId => !firstQualifiedByJob.has(jobId)).length,
    },
    recommendation_acceptance: { value: ratio(accepted, reviewed.length), numerator: accepted, denominator: reviewed.length },
    human_override: { value: ratio(overridden.length, reviewed.length), numerator: overridden.length, denominator: reviewed.length, reasons: overrideReasons },
    outreach_reply: outreachReply,
    interview_conversion: replyInterview,
    offer_conversion: interviewOffer,
    hire_conversion: offerHire,
    withdrawal: { value: ratio(withdrawals, processedSubjects.size), numerator: withdrawals, denominator: processedSubjects.size },
    complaint: { value: ratio(complaints, processedSubjects.size), numerator: complaints, denominator: processedSubjects.size },
    compliance: {
      rights_request_overdue_rate: ratio(overdue, rights.length),
      overdue_requests: overdue,
      rights_request_sample_size: rights.length,
      expired_authorization_active_processing_count: input.expired_authorization_active_processing_count,
    },
    processed_candidate_sample_size: processedSubjects.size,
  };
}
