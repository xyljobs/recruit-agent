import assert from 'node:assert/strict';
import test from 'node:test';
import { signWebhookBody, verifyWebhookSignature } from './webhook';

const now = new Date('2026-08-02T00:00:00.000Z');
const timestamp = String(Math.floor(now.getTime() / 1000));
const rawBody = '{"event":"candidate_replied"}';

test('accepts a valid current webhook signature', () => {
  assert.equal(verifyWebhookSignature({
    secret: 'secret', timestamp, raw_body: rawBody,
    signature: signWebhookBody('secret', timestamp, rawBody), now,
  }), true);
});

test('rejects tampering and timestamps outside the five minute window', () => {
  const signature = signWebhookBody('secret', timestamp, rawBody);
  assert.equal(verifyWebhookSignature({ secret: 'secret', timestamp, signature, raw_body: `${rawBody}x`, now }), false);
  assert.equal(verifyWebhookSignature({
    secret: 'secret', timestamp, signature, raw_body: rawBody,
    now: new Date(now.getTime() + 301_000),
  }), false);
});
