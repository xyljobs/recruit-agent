import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMatchScoringMutation,
  type MatchScoringWrite,
} from './match-record-store';

test('评分写入永不包含招聘状态和状态历史', () => {
  const untrusted = {
    scoring_status: 'succeeded',
    overall_score: 88,
    status: 'pending',
    status_history: [],
  } as unknown as MatchScoringWrite;

  const mutation = buildMatchScoringMutation(untrusted);

  assert.equal(mutation.scoring_status, 'succeeded');
  assert.equal(mutation.overall_score, 88);
  assert.equal(Object.hasOwn(mutation, 'status'), false);
  assert.equal(Object.hasOwn(mutation, 'status_history'), false);
});
