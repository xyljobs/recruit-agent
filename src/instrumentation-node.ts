import { getSupabaseServiceClient } from '@/storage/database/supabase-client';

interface RequiredTable {
  name: string;
  columns: string;
}

const REQUIRED_PRODUCTION_TABLES: RequiredTable[] = [
  { name: 'organizations', columns: 'id, is_active, ai_execution_mode, approved_cloud_processors' },
  { name: 'users', columns: 'id, organization_id, auth_version, is_active' },
  {
    name: 'organization_members',
    columns: 'user_id, organization_id, role, is_active',
  },
  {
    name: 'auth_sessions',
    columns: 'id, user_id, organization_id, auth_version, revoked_at, expires_at',
  },
  { name: 'job_requirements', columns: 'id, organization_id' },
  { name: 'candidates', columns: 'id, organization_id' },
  { name: 'match_records', columns: 'id, organization_id, status, status_history' },
  {
    name: 'match_status_events',
    columns: 'id, organization_id, match_record_id, status, created_at',
  },
  { name: 'match_runs', columns: 'id, organization_id, match_record_id' },
  { name: 'match_batch_tasks', columns: 'id, organization_id, user_id, status' },
  {
    name: 'integration_connections',
    columns: 'id, organization_id, connector_type, status, capabilities',
  },
  {
    name: 'external_entity_links',
    columns: 'id, organization_id, integration_id, entity_type',
  },
  {
    name: 'integration_sync_runs',
    columns: 'id, organization_id, integration_id, direction, status',
  },
  {
    name: 'shortlist_runs',
    columns: 'id, organization_id, job_id, status, scoring_weights_version',
  },
  {
    name: 'shortlist_entries',
    columns: 'id, organization_id, shortlist_run_id, candidate_id, rank',
  },
  {
    name: 'recommendation_decision_events',
    columns: 'id, organization_id, shortlist_entry_id, decision, occurred_at',
  },
  {
    name: 'recruiting_outcome_events',
    columns: 'id, organization_id, candidate_id, event_type, occurred_at',
  },
  {
    name: 'candidate_rights_requests',
    columns: 'id, organization_id, candidate_id, request_type, status, due_at',
  },
  {
    name: 'communication_briefs',
    columns: 'id, organization_id, shortlist_entry_id',
  },
  {
    name: 'integration_outbox',
    columns: 'id, organization_id, integration_id, outcome_event_id, status, client_event_id, payload_fingerprint',
  },
  {
    name: 'scoring_weight_versions',
    columns: 'id, organization_id, version, weights, status',
  },
  {
    name: 'calibration_proposals',
    columns: 'id, organization_id, status, proposed_weights, reviewed_entries',
  },
  { name: 'api_rate_limits', columns: 'id, organization_id, user_id' },
  { name: 'boss_search_tasks', columns: 'id, organization_id, user_id' },
  { name: 'boss_contact_requests', columns: 'id, organization_id, task_id' },
  { name: 'resume_batch_credentials', columns: 'id, organization_id' },
  { name: 'resume_batch_settings', columns: 'organization_id, workers, updated_at' },
  { name: 'resume_batch_sheets', columns: 'id, organization_id' },
  { name: 'resume_batch_tasks', columns: 'id, organization_id, user_id' },
];

const SCHEMA_CHECK_MAX_ATTEMPTS = 3;

async function checkTableWithRetry(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  table: RequiredTable,
): Promise<void> {
  let lastError: { message?: string; code?: string } | null = null;
  for (let attempt = 1; attempt <= SCHEMA_CHECK_MAX_ATTEMPTS; attempt++) {
    const { error } = await supabase
      .from(table.name)
      .select(table.columns)
      .limit(1);
    if (!error) {
      return;
    }
    lastError = error;
    if (attempt < SCHEMA_CHECK_MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
    }
  }
  throw new Error(
    `数据库安全架构未就绪（${table.name}）：请先完整执行 scripts/migrate.sql（底层错误：${lastError?.code ?? ''} ${lastError?.message ?? 'unknown'}）`,
  );
}

export async function assertProductionSchema(): Promise<void> {
  const supabase = getSupabaseServiceClient();

  for (const table of REQUIRED_PRODUCTION_TABLES) {
    await checkTableWithRetry(supabase, table);
  }
}
