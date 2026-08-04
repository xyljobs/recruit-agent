import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEvidenceSnapshot,
  latestEffectiveDecision,
  rankShortlist,
  shortlistDecisionSchema,
  structuredEvidenceSchema,
} from './shortlist';

test('ranks deterministically, takes Top N, and assigns review-priority bands', () => {
  const input = [
    { candidate_id: 'candidate-c', overall_score: 80, confidence_score: 70 },
    { candidate_id: 'candidate-b', overall_score: 90, confidence_score: 80 },
    { candidate_id: 'candidate-a', overall_score: 90, confidence_score: 80 },
    { candidate_id: 'candidate-d', overall_score: 90, confidence_score: 40 },
    { candidate_id: 'candidate-e', overall_score: 70, confidence_score: 100 },
  ];

  const ranked = rankShortlist(input, 4);

  assert.deepEqual(
    ranked.map(({ candidate_id, rank, recommendation_band }) => ({
      candidate_id,
      rank,
      recommendation_band,
    })),
    [
      { candidate_id: 'candidate-a', rank: 1, recommendation_band: 'strong' },
      { candidate_id: 'candidate-b', rank: 2, recommendation_band: 'strong' },
      {
        candidate_id: 'candidate-d',
        rank: 3,
        recommendation_band: 'insufficient_information',
      },
      { candidate_id: 'candidate-c', rank: 4, recommendation_band: 'consider' },
    ],
  );
  assert.deepEqual(input.map(item => item.candidate_id), [
    'candidate-c',
    'candidate-b',
    'candidate-a',
    'candidate-d',
    'candidate-e',
  ]);
});

test('preserves input order only after all documented tie-breakers match', () => {
  const ranked = rankShortlist([
    { candidate_id: 'same', overall_score: 70, confidence_score: 70, source: 'first' },
    { candidate_id: 'same', overall_score: 70, confidence_score: 70, source: 'second' },
  ], 2);

  assert.deepEqual(ranked.map(item => item.source), ['first', 'second']);
});

test('bounds both excerpts to 200 Unicode characters', () => {
  const longExcerpt = '证'.repeat(205);
  const [snapshot] = createEvidenceSnapshot([{
    criterion_id: 'skill-typescript',
    dimension: 'skills',
    finding: '候选人简历提到了 TypeScript 项目经验',
    support_level: 'supported',
    candidate_source_path: 'candidate.resume_text',
    candidate_excerpt: longExcerpt,
    job_source_path: 'job.skills_required[0]',
    job_excerpt: longExcerpt,
  }]);

  assert.equal([...snapshot.candidate_excerpt!].length, 200);
  assert.equal([...snapshot.job_excerpt!].length, 200);
  assert.equal(structuredEvidenceSchema.safeParse({
    ...snapshot,
    overall_score: 100,
  }).success, false);
});

test('requires an override reason and a note for other', () => {
  const base = {
    client_event_id: 'd9428888-122b-4a02-b6f7-5b24c9a2e168',
    occurred_at: '2026-08-02T08:30:00.000Z',
  };

  assert.equal(shortlistDecisionSchema.safeParse({
    ...base,
    decision: 'accepted',
  }).success, true);
  assert.equal(shortlistDecisionSchema.safeParse({
    ...base,
    decision: 'overridden',
  }).success, false);
  assert.equal(shortlistDecisionSchema.safeParse({
    ...base,
    decision: 'overridden',
    reason_code: 'other',
    note: '   ',
  }).success, false);
  assert.equal(shortlistDecisionSchema.safeParse({
    ...base,
    decision: 'overridden',
    reason_code: 'incorrect_evidence',
  }).success, true);
  assert.equal(shortlistDecisionSchema.safeParse({
    ...base,
    decision: 'overridden',
    reason_code: 'other',
    note: '候选人的项目职责未在证据中体现',
  }).success, true);
});

test('selects the latest decision by occurred_at, recorded_at, then id', () => {
  const events = [
    {
      id: 'b',
      decision: 'accepted',
      occurred_at: '2026-08-02T10:00:00.000Z',
      recorded_at: '2026-08-02T10:01:00.000Z',
    },
    {
      id: 'z',
      decision: 'overridden',
      occurred_at: '2026-08-02T09:00:00.000Z',
      recorded_at: '2026-08-02T11:00:00.000Z',
    },
    {
      id: 'a',
      decision: 'needs_information',
      occurred_at: '2026-08-02T10:00:00.000Z',
      recorded_at: '2026-08-02T10:02:00.000Z',
    },
    {
      id: 'c',
      decision: 'overridden',
      occurred_at: '2026-08-02T10:00:00.000Z',
      recorded_at: '2026-08-02T10:02:00.000Z',
    },
  ];

  assert.equal(latestEffectiveDecision(events)?.id, 'c');
  assert.equal(latestEffectiveDecision([]), null);
});
