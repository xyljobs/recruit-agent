export function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export function getJwtSecretKey(): Uint8Array {
  return new TextEncoder().encode(getRequiredEnv('JWT_SECRET'));
}

export function getSupabaseJwtSecretKey(): Uint8Array {
  return new TextEncoder().encode(getRequiredEnv('SUPABASE_JWT_SECRET'));
}

export function getRequiredHexKey(name: string): Buffer {
  const value = getRequiredEnv(name);
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${name} must be a 64-character hexadecimal string`);
  }
  return Buffer.from(value, 'hex');
}
