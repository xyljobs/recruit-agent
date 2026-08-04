import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ApiRequestError,
  batchMatchBodySchema,
  bossExecuteBodySchema,
  candidateListQuerySchema,
  jdParseBodySchema,
  MAX_BATCH_MATCH_CANDIDATES,
  MAX_JD_LENGTH,
  parseLimitedJson,
} from './api-limits';
import { enforceRateLimit, RATE_LIMITS } from './rate-limit';

test('candidate pagination enforces a server-side page size cap', () => {
  assert.equal(candidateListQuerySchema.safeParse({ pageSize: '100' }).success, true);
  assert.equal(candidateListQuerySchema.safeParse({ pageSize: '101' }).success, false);
  assert.equal(candidateListQuerySchema.safeParse({ pageSize: '-1' }).success, false);
});

test('Boss execution enforces per-keyword and total candidate caps', () => {
  const valid = bossExecuteBodySchema.safeParse({
    keywords: Array.from({ length: 4 }, (_, index) => ({
      keyword: `关键词${index}`,
      count: 10,
    })),
  });
  assert.equal(valid.success, true);

  const tooMany = bossExecuteBodySchema.safeParse({
    keywords: Array.from({ length: 5 }, (_, index) => ({
      keyword: `关键词${index}`,
      count: index === 0 ? 10 : 8,
    })),
  });
  assert.equal(tooMany.success, false);
});

test('batch matching caps candidate IDs and top results', () => {
  const candidateIds = Array.from(
    { length: MAX_BATCH_MATCH_CANDIDATES + 1 },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  );
  const result = batchMatchBodySchema.safeParse({
    job_id: '00000000-0000-4000-8000-000000000001',
    client_event_id: '00000000-0000-4000-8000-000000000002',
    candidate_ids: candidateIds,
    top_n: 10,
  });
  assert.equal(result.success, false);
});

test('batch matching requires a client event ID for retry-safe shortlist creation', () => {
  const valid = {
    job_id: '00000000-0000-4000-8000-000000000001',
    client_event_id: '00000000-0000-4000-8000-000000000002',
    candidate_ids: ['00000000-0000-4000-8000-000000000003'],
    top_n: 1,
  };

  assert.equal(batchMatchBodySchema.safeParse(valid).success, true);
  assert.equal(batchMatchBodySchema.safeParse({
    job_id: valid.job_id,
    candidate_ids: valid.candidate_ids,
    top_n: valid.top_n,
  }).success, false);
});

test('JD schema rejects oversized content', () => {
  const result = jdParseBodySchema.safeParse({
    jdContent: 'a'.repeat(MAX_JD_LENGTH + 1),
  });
  assert.equal(result.success, false);
});

test('limited JSON reader stops streamed bodies above the byte cap', async () => {
  const request = new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jdContent: '招聘'.repeat(100) }),
  });

  await assert.rejects(
    () => parseLimitedJson(request, jdParseBodySchema, 64),
    (error: unknown) => error instanceof ApiRequestError && error.status === 413,
  );
});

test('database rate limiter returns a retryable 429 error', async () => {
  const supabase = {
    rpc: async () => ({
      data: [{ allowed: false, remaining: 0, retry_after_seconds: 17 }],
      error: null,
    }),
  } as unknown as SupabaseClient;

  await assert.rejects(
    () => enforceRateLimit(supabase, RATE_LIMITS.jdParse),
    (error: unknown) => (
      error instanceof ApiRequestError
      && error.status === 429
      && error.headers?.['Retry-After'] === '17'
    ),
  );
});
