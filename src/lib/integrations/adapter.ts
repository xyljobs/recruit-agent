export interface IntegrationPageRecord {
  external_id: string;
  local_entity_id?: string;
  source_updated_at?: string;
  data?: Readonly<Record<string, unknown>>;
  authorization?: Readonly<Record<string, unknown>>;
}

export interface IntegrationPage {
  records: IntegrationPageRecord[];
  cursor_before: string | null;
  cursor_after: string | null;
}

export interface IntegrationWritebackReceipt {
  external_receipt_id: string;
  received_at: string;
}

/** Vendor-neutral boundary; customer-specific adapters implement only declared capabilities. */
export interface RecruitmentSourceAdapter {
  readonly type: string;
  readPage(cursor: string | null, limit: number): Promise<IntegrationPage>;
  writeOutcome?(payload: Readonly<Record<string, unknown>>, idempotencyKey: string): Promise<IntegrationWritebackReceipt>;
}
