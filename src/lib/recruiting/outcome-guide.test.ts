import assert from 'node:assert/strict';
import test from 'node:test';
import {
  guideQuestionResultSchema,
  interviewFeedbackMetadataSchema,
  recruitingOutcomeBodySchema,
} from '@/lib/recruiting/api-contracts';

const id = '0c2f9d5a-5f3f-4a2b-9c7d-1e2f3a4b5c6d';
const guideId = '7a1b2c3d-4e5f-6a7b-8c9d-8e1f2a3b4c5d';

const questionResult = {
  question: '请补充说明：主导过的自动化产线项目；并举一个可核验的实例',
  origin: 'evidence_gap',
  hit: true,
};

test('guide question result schema validates hit records', () => {
  assert.equal(guideQuestionResultSchema.safeParse(questionResult).success, true);
  assert.equal(guideQuestionResultSchema.safeParse({
    ...questionResult,
    origin: 'unknown_source',
  }).success, false);
  assert.equal(guideQuestionResultSchema.safeParse({
    ...questionResult,
    hit: 'yes',
  }).success, false);
});

test('interview feedback metadata links guide and question results', () => {
  assert.equal(interviewFeedbackMetadataSchema.safeParse({
    summary: '技术面试通过',
    verdict: 'pass',
    interview_guide_id: guideId,
    question_results: [questionResult],
  }).success, true);
  // 只关联提纲不逐题打分也允许
  assert.equal(interviewFeedbackMetadataSchema.safeParse({
    summary: '技术面试通过',
    verdict: 'pass',
    interview_guide_id: guideId,
  }).success, true);
  // 记录命中情况必须关联提纲
  assert.equal(interviewFeedbackMetadataSchema.safeParse({
    summary: '技术面试通过',
    verdict: 'pass',
    question_results: [questionResult],
  }).success, false);
  // 命中结果最多 10 条（提纲专项题上限）
  assert.equal(interviewFeedbackMetadataSchema.safeParse({
    summary: '技术面试通过',
    verdict: 'pass',
    interview_guide_id: guideId,
    question_results: Array.from({ length: 11 }, (_, index) => ({
      ...questionResult,
      question: `${questionResult.question}${index}`,
    })),
  }).success, false);
});

test('recruiting outcome body carries guide linkage for interview feedback', () => {
  const base = {
    match_record_id: id,
    event_type: 'interview_feedback',
    client_event_id: '3b2c4d5e-6f7a-8b9c-8d1e-2f3a4b5c6d7e',
    occurred_at: '2026-08-10T14:30:00+08:00',
  };
  assert.equal(recruitingOutcomeBodySchema.safeParse({
    ...base,
    metadata: {
      summary: '技术面试通过',
      verdict: 'pass',
      interview_guide_id: guideId,
      question_results: [questionResult],
    },
  }).success, true);
  assert.equal(recruitingOutcomeBodySchema.safeParse({
    ...base,
    metadata: {
      summary: '技术面试通过',
      verdict: 'pass',
      question_results: [questionResult],
    },
  }).success, false);
  // 其他事件类型仍不允许携带提纲关联字段
  assert.equal(recruitingOutcomeBodySchema.safeParse({
    ...base,
    event_type: 'outreach_sent',
    metadata: { interview_guide_id: guideId },
  }).success, false);
});
