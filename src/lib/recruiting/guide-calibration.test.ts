import assert from 'node:assert/strict';
import test from 'node:test';
import { computeGuideHitStats, type GuideCalibrationEvent } from './guide-calibration';

const guideA = '7a1b2c3d-4e5f-6a7b-8c9d-8e1f2a3b4c5d';
const guideB = '8b2c3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e';

function feedbackEvent(
  metadata: Record<string, unknown> | null,
): GuideCalibrationEvent {
  return { event_type: 'interview_feedback', metadata };
}

test('empty events produce zero stats with null hit rate', () => {
  const stats = computeGuideHitStats([]);
  assert.equal(stats.feedback_events, 0);
  assert.equal(stats.total_results, 0);
  assert.equal(stats.hit_rate, null);
  assert.deepEqual(stats.by_origin, []);
  assert.deepEqual(stats.by_guide, []);
});

test('only interview_feedback events with guide linkage are counted', () => {
  const stats = computeGuideHitStats([
    { event_type: 'outreach_sent', metadata: { interview_guide_id: guideA } },
    feedbackEvent({ summary: 'x', verdict: 'pass' }),
    feedbackEvent({
      summary: 'x',
      verdict: 'pass',
      interview_guide_id: guideA,
      question_results: [{ question: 'q1', origin: 'depth_check', hit: true }],
    }),
  ]);
  assert.equal(stats.feedback_events, 1);
  assert.equal(stats.events_with_results, 1);
  assert.equal(stats.total_results, 1);
  assert.equal(stats.hit_rate, 1);
});

test('malformed question result entries are skipped without throwing', () => {
  const stats = computeGuideHitStats([
    feedbackEvent({
      interview_guide_id: guideA,
      question_results: [
        { question: 'q1', origin: 'depth_check', hit: true },
        { question: 'q2', origin: 'depth_check', hit: 'yes' },
        { question: 'q3', origin: 'unknown_origin', hit: false },
        { question: '', origin: 'evidence_gap', hit: true },
        'not-an-object',
        null,
      ],
    }),
  ]);
  assert.equal(stats.total_results, 1);
  assert.equal(stats.hit_count, 1);
});

test('aggregates by origin with fixed origin order and rounded rates', () => {
  const stats = computeGuideHitStats([
    feedbackEvent({
      interview_guide_id: guideA,
      question_results: [
        { question: 'q1', origin: 'depth_check', hit: true },
        { question: 'q2', origin: 'depth_check', hit: false },
        { question: 'q3', origin: 'depth_check', hit: false },
        { question: 'q4', origin: 'evidence_gap', hit: true },
      ],
    }),
  ]);
  assert.equal(stats.hit_rate, 0.5);
  assert.deepEqual(stats.by_origin, [
    { key: 'evidence_gap', total: 1, hit_count: 1, hit_rate: 1 },
    { key: 'depth_check', total: 3, hit_count: 1, hit_rate: 0.333 },
  ]);
});

test('aggregates by guide sorted by total desc then key', () => {
  const stats = computeGuideHitStats([
    feedbackEvent({
      interview_guide_id: guideA,
      question_results: [{ question: 'q1', origin: 'depth_check', hit: true }],
    }),
    feedbackEvent({
      interview_guide_id: guideB,
      question_results: [
        { question: 'q2', origin: 'depth_check', hit: false },
        { question: 'q3', origin: 'evidence_gap', hit: true },
      ],
    }),
  ]);
  assert.equal(stats.feedback_events, 2);
  assert.equal(stats.total_results, 3);
  assert.deepEqual(stats.by_guide.map(group => group.key), [guideB, guideA]);
  assert.equal(stats.by_guide[0].hit_rate, 0.5);
});
