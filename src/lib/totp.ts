import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

function encodeBase32(input: Buffer): string {
  let bits = '';
  for (const byte of input) {
    bits += byte.toString(2).padStart(8, '0');
  }

  let encoded = '';
  for (let offset = 0; offset < bits.length; offset += 5) {
    const chunk = bits.slice(offset, offset + 5).padEnd(5, '0');
    encoded += BASE32_ALPHABET[Number.parseInt(chunk, 2)];
  }
  return encoded;
}

function decodeBase32(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = '';
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) {
      throw new Error('MFA 密钥格式无效');
    }
    bits += index.toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function totpAt(secret: string, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  );
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, '0');
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function verifyTotp(
  secret: string,
  code: string,
  now = Date.now(),
): number | null {
  const normalizedCode = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalizedCode)) {
    return null;
  }

  const currentCounter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
  for (const offset of [-1, 0, 1]) {
    const counter = currentCounter + offset;
    const expected = totpAt(secret, counter);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(normalizedCode))) {
      return counter;
    }
  }
  return null;
}

export function createTotpUri(secret: string, email: string): string {
  const issuer = '人才决策Agent';
  const label = `${issuer}:${email}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: 8 }, () => {
    const value = randomBytes(8).toString('hex').toUpperCase();
    return `${value.slice(0, 8)}-${value.slice(8)}`;
  });
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256')
    .update(code.trim().toUpperCase().replace(/\s+/g, ''))
    .digest('hex');
}
