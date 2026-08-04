import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { decrypt } from '@/lib/encryption';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';

for (const name of ['SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ENCRYPTION_KEY']) {
  const secretPath = process.env[`${name}_FILE`]?.trim();
  if (!secretPath) continue;
  if (process.env[name]?.trim()) throw new Error(`${name} and ${name}_FILE cannot both be set`);
  if (!existsSync(secretPath)) throw new Error(`${name}_FILE does not exist`);
  const value = readFileSync(secretPath, 'utf8').trim();
  if (!value) throw new Error(`${name}_FILE points to an empty secret`);
  process.env[name] = value;
}

const WORKER_ID = process.env.INTEGRATION_OUTBOX_WORKER_ID
  || `integration-worker-${hostname()}-${randomUUID().slice(0, 8)}`;
const INTERVAL_MS = 2_000;
const ALLOWED_OUTBOUND_HOSTS = new Set(
  (process.env.INTEGRATION_OUTBOUND_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean),
);

const taskSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  integration_id: z.string().uuid(),
  action_type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  configuration_encrypted: z.string().min(1),
  client_event_id: z.string().uuid(),
  attempt_count: z.number().int().positive(),
  lease_until: z.string(),
});
const configurationSchema = z.object({
  writeback_url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
}).strict();

async function claimTask() {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc('claim_integration_outbox', {
    p_worker_id: WORKER_ID,
    p_lease_seconds: 300,
  });
  if (error) throw new Error(`认领 ATS 回写失败: ${error.message}`);
  if (!data) return null;
  const parsed = taskSchema.safeParse(data);
  if (!parsed.success) throw new Error(`ATS 回写任务结构无效: ${parsed.error.message}`);
  return parsed.data;
}

async function completeTask(
  task: z.infer<typeof taskSchema>,
  succeeded: boolean,
  receipt?: Record<string, unknown>,
  errorMessage?: string,
) {
  const { error } = await getSupabaseServiceClient().rpc('complete_integration_outbox', {
    p_organization_id: task.organization_id,
    p_outbox_id: task.id,
    p_worker_id: WORKER_ID,
    p_succeeded: succeeded,
    p_external_receipt: receipt ?? null,
    p_error: errorMessage?.slice(0, 2_000) ?? null,
  });
  if (error) throw new Error(`完成 ATS 回写任务失败: ${error.message}`);
}

async function processTask(task: z.infer<typeof taskSchema>): Promise<void> {
  try {
    const configurationText = decrypt(task.configuration_encrypted);
    if (!configurationText || configurationText === '[解密失败]') {
      throw new Error('数据源配置无法解密');
    }
    const configuration = configurationSchema.parse(JSON.parse(configurationText));
    const url = new URL(configuration.writeback_url);
    if (url.protocol !== 'https:') throw new Error('ATS 回写端点必须使用 HTTPS');
    if (ALLOWED_OUTBOUND_HOSTS.size === 0
      || !ALLOWED_OUTBOUND_HOSTS.has(url.hostname.toLowerCase())) {
      throw new Error('ATS 回写端点不在部署级域名白名单中');
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...configuration.headers,
        'Content-Type': 'application/json',
        'Idempotency-Key': task.client_event_id,
        'X-Recruiting-Outcome-Type': task.action_type,
      },
      body: JSON.stringify(task.payload),
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`外部 ATS 返回 HTTP ${response.status}`);
    await completeTask(task, true, {
      external_receipt_id: response.headers.get('x-request-id') ?? task.client_event_id,
      http_status: response.status,
      received_at: new Date().toISOString(),
    });
  } catch (error) {
    await completeTask(task, false, undefined, error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  const once = process.argv.includes('--once');
  while (true) {
    const task = await claimTask();
    if (task) await processTask(task);
    if (once) return;
    await delay(INTERVAL_MS);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
