import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiRequestError } from '@/lib/api-limits';
import {
  communicationBriefBodySchema,
  normalizeRecruitingApiError,
  parseStrictSearchParams,
  recruitingOutcomeBodySchema,
  rpcErrorToRequestError,
  shortlistCreateBodySchema,
  shortlistListQuerySchema,
} from './api-contracts';

const id = '550e8400-e29b-41d4-a716-446655440000';
const secondId = '550e8400-e29b-41d4-a716-446655440001';

test('shortlist submission is strict and idempotent-keyed', () => {
  assert.equal(shortlistCreateBodySchema.safeParse({
    job_id: id,
    candidate_ids: [secondId],
    client_event_id: id,
  }).success, true);
  assert.equal(shortlistCreateBodySchema.safeParse({
    job_id: id,
    candidate_ids: [secondId, secondId],
    client_event_id: id,
  }).success, false);
  assert.equal(shortlistCreateBodySchema.safeParse({
    job_id: id,
    client_event_id: id,
    unexpected: true,
  }).success, false);
});

test('outcomes require human accountability fields', () => {
  const base = {
    match_record_id: id,
    client_event_id: secondId,
    occurred_at: '2026-08-01T12:00:00+08:00',
  };
  assert.equal(recruitingOutcomeBodySchema.safeParse({
    ...base,
    event_type: 'rejected',
  }).success, false);
  assert.equal(recruitingOutcomeBodySchema.safeParse({
    ...base,
    event_type: 'rejected',
    reason_code: 'requirements_changed',
  }).success, true);
  assert.equal(recruitingOutcomeBodySchema.safeParse({
    ...base,
    event_type: 'stage_corrected',
    reason_code: 'incorrect_import',
    target_stage: 'interviewing',
    supersedes_event_id: id,
  }).success, true);
  assert.equal(recruitingOutcomeBodySchema.safeParse({
    ...base,
    event_type: 'offer',
    target_stage: 'offered',
  }).success, false);
});

test('communication brief accepts one selection reference only', () => {
  assert.equal(communicationBriefBodySchema.safeParse({
    shortlist_entry_id: id,
  }).success, true);
  assert.equal(communicationBriefBodySchema.safeParse({ matchId: id }).success, true);
  assert.equal(communicationBriefBodySchema.safeParse({
    shortlist_entry_id: id,
    matchId: secondId,
  }).success, false);
});

test('query parsing rejects unknown and duplicate parameters', () => {
  assert.throws(
    () => parseStrictSearchParams(
      new URLSearchParams('status=ready&status=failed'),
      shortlistListQuerySchema,
    ),
    (error: unknown) => error instanceof ApiRequestError && error.status === 400,
  );
  assert.throws(
    () => parseStrictSearchParams(
      new URLSearchParams('unknown=true'),
      shortlistListQuerySchema,
    ),
    (error: unknown) => error instanceof ApiRequestError && error.status === 400,
  );
});

test('database unique conflicts map to HTTP 409 without leaking details', () => {
  const error = rpcErrorToRequestError({ code: '23505' }, '写入失败');
  assert.equal(error.status, 409);
  assert.equal(error.message, '幂等键已用于不同请求');
});

test('expired sessions map to HTTP 401', () => {
  const error = normalizeRecruitingApiError(new Error('登录已失效'), '请求失败');
  assert.equal(error.status, 401);
});
