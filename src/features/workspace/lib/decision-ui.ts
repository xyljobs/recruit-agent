import type { IntegrationConnection, ShortlistRun } from '../decision-types';

export function normalizeShortlistRuns(value: unknown): ShortlistRun[] {
  if (Array.isArray(value)) return value as ShortlistRun[];
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.runs)) return record.runs as ShortlistRun[];
  if (Array.isArray(record.shortlists)) return record.shortlists as ShortlistRun[];
  return [];
}

export function outcomeReasonLabel(eventType: string): string | null {
  if (eventType === 'rejected') return '拒绝原因（必填）';
  if (eventType === 'withdrawn') return '撤回原因（必填）';
  if (eventType === 'complaint') return '投诉分类（必填）';
  return null;
}

interface IntegrationApiConnection extends Partial<IntegrationConnection> {
  id: string;
  name: string;
  connector_type?: string;
  latest_sync?: {
    status?: string;
    error_summary?: string | null;
    cursor_after?: string | null;
    finished_at?: string | null;
    created_at?: string | null;
  } | null;
}

export function normalizeIntegrationConnections(value: unknown): IntegrationConnection[] {
  if (!Array.isArray(value)) return [];
  return (value as IntegrationApiConnection[]).map((connection) => ({
    id: connection.id,
    name: connection.name,
    connection_type: connection.connection_type ?? connection.connector_type ?? 'unknown',
    enabled: connection.enabled ?? connection.status === 'enabled',
    status: connection.status ?? 'disabled',
    data_boundary_mode: connection.data_boundary_mode ?? null,
    model_endpoint_classification: connection.model_endpoint_classification ?? null,
    external_processors: connection.external_processors ?? [],
    last_sync_status: connection.last_sync_status ?? connection.latest_sync?.status ?? null,
    last_sync_error: connection.last_sync_error ?? connection.latest_sync?.error_summary ?? null,
    last_sync_at: connection.last_sync_at ?? connection.latest_sync?.finished_at ?? connection.latest_sync?.created_at ?? null,
    last_sync_cursor: connection.last_sync_cursor ?? connection.latest_sync?.cursor_after ?? null,
  }));
}
