import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canPrepareCommunicationBrief,
  createRulesOnlyCommunicationBrief,
  parseModelCommunicationBrief,
  STANDARD_PROHIBITED_CLAIMS,
} from './communication-brief';

const baseInput = {
  candidate_name: '王女士',
  current_position: '前端工程师',
  job_title: '高级前端工程师',
  salary_range: '25-35K',
  location: '杭州',
  communication_goal: '想邀请您了解职位详情。',
  evidence: [
    { finding: '具备 React 项目经验', support_level: 'supported' },
    { finding: '团队管理年限尚不明确', support_level: 'partial' },
  ],
  missing_information: ['到岗时间'],
};

test('rules-only brief is deterministic, structured, and avoids decision claims', () => {
  const first = createRulesOnlyCommunicationBrief(baseInput);
  const second = createRulesOnlyCommunicationBrief(baseInput);
  assert.deepEqual(first, second);
  assert.deepEqual(first.candidate_value_points, ['具备 React 项目经验']);
  assert.deepEqual(first.facts_to_verify, ['到岗时间', '团队管理年限尚不明确']);
  assert.equal(first.draft_message.includes('录用您'), false);
  assert.deepEqual(first.prohibited_claims, [...STANDARD_PROHIBITED_CLAIMS]);
});

test('model brief parser accepts fenced JSON and always adds core prohibitions', () => {
  const result = parseModelCommunicationBrief(`\`\`\`json
  {
    "candidate_value_points": ["经验相关"],
    "facts_to_verify": [],
    "interview_questions": ["请介绍项目"],
    "prohibited_claims": [],
    "draft_message": "您好，想与您进一步沟通。"
  }
  \`\`\``);
  assert.equal(result.prohibited_claims.length, STANDARD_PROHIBITED_CLAIMS.length);
});

test('model brief parser rejects score fields and other unexpected output', () => {
  assert.throws(() => parseModelCommunicationBrief(JSON.stringify({
    candidate_value_points: [],
    facts_to_verify: [],
    interview_questions: [],
    prohibited_claims: [],
    draft_message: '您好',
    score: 99,
  })));
});

test('communication preparation requires both the snapshot and latest event to be accepted', () => {
  assert.equal(canPrepareCommunicationBrief('accepted', 'accepted'), true);
  assert.equal(canPrepareCommunicationBrief('accepted', 'overridden'), false);
  assert.equal(canPrepareCommunicationBrief('overridden', 'accepted'), false);
  assert.equal(canPrepareCommunicationBrief('accepted', null), false);
});
