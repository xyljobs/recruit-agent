import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCumulativeFunnel,
  calculateAverageScores,
} from './dashboard-metrics';

test('average scores describe model scores without treating missing values as zero', () => {
  const result = calculateAverageScores([
    {
      overall_score: 80,
      skill_score: 90,
      experience_score: null,
    },
    {
      overall_score: 60,
      skill_score: null,
      experience_score: 70,
    },
  ]);

  assert.deepEqual(result, {
    overall: 70,
    skill: 90,
    experience: 70,
    education: null,
    salary: null,
    location: null,
    availability: null,
    stability: null,
  });
});

test('funnel counts records that ever reached each stage instead of current statuses', () => {
  const result = buildCumulativeFunnel([
    { status: 'pending', status_history: [] },
    {
      status: 'interviewing',
      status_history: [
        { status: 'contacted', time: '2026-07-01T00:00:00.000Z' },
        { status: 'interviewing', time: '2026-07-02T00:00:00.000Z' },
      ],
    },
    {
      status: 'hired',
      status_history: [
        { status: 'contacted', time: '2026-07-01T00:00:00.000Z' },
        { status: 'interviewing', time: '2026-07-02T00:00:00.000Z' },
        { status: 'offered', time: '2026-07-03T00:00:00.000Z' },
        { status: 'hired', time: '2026-07-04T00:00:00.000Z' },
      ],
    },
    {
      status: 'rejected',
      status_history: [
        { status: 'contacted', time: '2026-07-01T00:00:00.000Z' },
        { status: 'interviewing', time: '2026-07-02T00:00:00.000Z' },
        { status: 'rejected', time: '2026-07-03T00:00:00.000Z' },
      ],
    },
  ]);

  assert.deepEqual(result, [
    { stage: '已完成匹配', count: 4, rate: 100 },
    { stage: '已联系', count: 3, rate: 75 },
    { stage: '进入面试', count: 3, rate: 75 },
    { stage: '已发 Offer', count: 1, rate: 25 },
    { stage: '已录用', count: 1, rate: 25 },
  ]);
});

test('funnel uses the current status as the latest event and de-duplicates repeated history', () => {
  const result = buildCumulativeFunnel([
    {
      status: 'contacted',
      status_history: [
        { status: 'contacted' },
        { status: 'contacted' },
        null,
        { status: 123 },
      ],
    },
    { status: 'offered', status_history: null },
  ]);

  assert.deepEqual(result, [
    { stage: '已完成匹配', count: 2, rate: 100 },
    { stage: '已联系', count: 1, rate: 50 },
    { stage: '进入面试', count: 0, rate: 0 },
    { stage: '已发 Offer', count: 1, rate: 50 },
    { stage: '已录用', count: 0, rate: 0 },
  ]);
});
