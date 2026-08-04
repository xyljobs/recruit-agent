import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDecisionMetrics, type DecisionMetricsInput } from './decision-metrics';

const base: DecisionMetricsInput = {
  from: '2026-07-01T00:00:00.000Z',
  to: '2026-08-01T00:00:00.000Z',
  as_of: '2026-08-01T00:00:00.000Z',
  timezone: 'Asia/Shanghai',
  outcomes: [],
  decisions: [],
  shortlist_runs: [],
  jobs: [],
  rights_requests: [],
  expired_authorization_active_processing_count: 0,
};

test('returns null rates rather than inventing zero-denominator results', () => {
  const result = calculateDecisionMetrics(base);
  assert.equal(result.recommendation_acceptance.value, null);
  assert.equal(result.outreach_reply.value, null);
  assert.equal(result.qualified_interviews_per_recruiter_week.value, null);
});

test('uses latest human decision and event cohorts', () => {
  const result = calculateDecisionMetrics({
    ...base,
    decisions: [
      { id: '1', shortlist_entry_id: 'e1', analytics_subject_id: 's1', job_id_snapshot: 'j1', recruiter_user_id_snapshot: 'u1', department_snapshot: '研发', decision: 'overridden', reason_code: 'stale_data', occurred_at: '2026-07-02T00:00:00Z', recorded_at: '2026-07-02T00:00:00Z' },
      { id: '2', shortlist_entry_id: 'e1', analytics_subject_id: 's1', job_id_snapshot: 'j1', recruiter_user_id_snapshot: 'u1', department_snapshot: '研发', decision: 'accepted', reason_code: null, occurred_at: '2026-07-03T00:00:00Z', recorded_at: '2026-07-03T00:00:00Z' },
    ],
    outcomes: [
      { id: 'o1', analytics_subject_id: 's1', job_id_snapshot: 'j1', recruiter_user_id_snapshot: 'u1', department_snapshot: '研发', event_type: 'outreach_sent', occurred_at: '2026-07-04T00:00:00Z', recorded_at: '2026-07-04T00:00:00Z', supersedes_event_id: null },
      { id: 'o2', analytics_subject_id: 's1', job_id_snapshot: 'j1', recruiter_user_id_snapshot: 'u1', department_snapshot: '研发', event_type: 'candidate_replied', occurred_at: '2026-07-05T00:00:00Z', recorded_at: '2026-07-05T00:00:00Z', supersedes_event_id: null },
    ],
  });
  assert.equal(result.recommendation_acceptance.value, 100);
  assert.equal(result.human_override.value, 0);
  assert.equal(result.outreach_reply.value, 100);
  assert.equal(result.outreach_reply.denominator, 1);
});

test('excludes superseded outcome events', () => {
  const result = calculateDecisionMetrics({
    ...base,
    outcomes: [
      { id: 'o1', analytics_subject_id: 's1', job_id_snapshot: 'j1', recruiter_user_id_snapshot: null, department_snapshot: null, event_type: 'outreach_sent', occurred_at: '2026-07-04T00:00:00Z', recorded_at: '2026-07-04T00:00:00Z', supersedes_event_id: null },
      { id: 'o2', analytics_subject_id: 's1', job_id_snapshot: 'j1', recruiter_user_id_snapshot: null, department_snapshot: null, event_type: 'stage_corrected', occurred_at: '2026-07-05T00:00:00Z', recorded_at: '2026-07-05T00:00:00Z', supersedes_event_id: 'o1' },
    ],
  });
  assert.equal(result.outreach_reply.denominator, 0);
});
