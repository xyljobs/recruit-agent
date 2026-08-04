import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_MAX_CLOCK_SKEW_SECONDS = 5 * 60;
export const INTEGRATION_BODY_LIMIT = 1024 * 1024;

export function signWebhookBody(secret: string, timestamp: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

export function verifyWebhookSignature(input: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  raw_body: string;
  now?: Date;
}): boolean {
  if (!input.timestamp || !input.signature || !/^\d{10,13}$/.test(input.timestamp)) return false;
  const rawTimestamp = Number(input.timestamp);
  const timestampMs = input.timestamp.length === 10 ? rawTimestamp * 1000 : rawTimestamp;
  const nowMs = (input.now ?? new Date()).getTime();
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > WEBHOOK_MAX_CLOCK_SKEW_SECONDS * 1000) {
    return false;
  }
  const expected = Buffer.from(signWebhookBody(input.secret, input.timestamp, input.raw_body));
  const provided = Buffer.from(input.signature);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
