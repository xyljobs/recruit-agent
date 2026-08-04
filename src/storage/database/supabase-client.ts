import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

let envLoaded = false;

interface SupabaseCredentials {
  url: string;
  anonKey: string;
}

function loadEnv(): void {
  if (envLoaded) {
    return;
  }

  dotenv.config({ path: resolve(process.cwd(), '.env.local'), quiet: true });
  dotenv.config({ quiet: true });
  envLoaded = true;
}

function getSupabaseCredentials(): SupabaseCredentials {
  loadEnv();

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error('SUPABASE_URL is not set');
  }
  if (!anonKey) {
    throw new Error('SUPABASE_ANON_KEY is not set');
  }

  return { url, anonKey };
}

function getSupabaseServiceRoleKey(): string | undefined {
  loadEnv();
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function createSupabaseClient(key: string, token?: string): SupabaseClient {
  const { url, anonKey } = getSupabaseCredentials();
  const globalOptions: Record<string, unknown> = {};

  if (token) {
    globalOptions.headers = { Authorization: `Bearer ${token}` };
  }

  return createClient(url, token ? anonKey : key, {
    global: globalOptions,
    db: {
      timeout: 60000,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function getSupabaseClient(token: string): SupabaseClient {
  if (!token) {
    throw new Error('Authenticated Supabase client requires a user token');
  }
  return createSupabaseClient(getSupabaseCredentials().anonKey, token);
}

function getSupabaseServiceClient(): SupabaseClient {
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }
  return createSupabaseClient(serviceRoleKey);
}

export {
  loadEnv,
  getSupabaseCredentials,
  getSupabaseServiceRoleKey,
  getSupabaseClient,
  getSupabaseServiceClient,
};
