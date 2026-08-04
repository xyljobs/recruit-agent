import type { TenantRequestContext } from '@/lib/auth-server';

type TenantSupabaseClient = TenantRequestContext['supabase'];

export interface AuthorizationGateRow {
  candidateId: string;
  authorizedAt: string | null;
  processingExpiresAt: string | null;
  isActive: boolean;
  evidenceStatus: string | null;
  automatedDecisionDisclosed: boolean;
  automatedDecisionPreference: string | null;
  automatedDecisionObjectedAt: string | null;
  impactAssessmentReference: string | null;
  impactAssessmentCompletedAt: string | null;
  externalProcessors: string[];
}

export interface AutomatedDecisionEligibility {
  allowed: boolean;
  reason:
    | 'allowed'
    | 'authorization_missing'
    | 'authorization_unverified'
    | 'authorization_expired'
    | 'human_review_only'
    | 'decision_notice_missing'
    | 'impact_assessment_missing';
  externalProcessors?: string[];
}

export interface ProcessableAuthorizationContext {
  processable: boolean;
  externalProcessors: string[];
}

export async function loadProcessableCandidateIds(
  supabase: TenantSupabaseClient,
  organizationId: string,
  candidateIds?: string[],
): Promise<string[]> {
  const rows = await loadAuthorizationGateRows(
    supabase,
    organizationId,
    candidateIds,
  );
  return rows
    .filter(row => isAuthorizationProcessable(row))
    .map(row => row.candidateId);
}

export async function loadAutomatedDecisionEligibleCandidateIds(
  supabase: TenantSupabaseClient,
  organizationId: string,
  candidateIds?: string[],
): Promise<string[]> {
  const rows = await loadAuthorizationGateRows(
    supabase,
    organizationId,
    candidateIds,
  );
  return rows
    .filter(row => evaluateAutomatedDecisionEligibility(row).allowed)
    .map(row => row.candidateId);
}

export async function getAutomatedDecisionEligibility(
  supabase: TenantSupabaseClient,
  organizationId: string,
  candidateId: string,
): Promise<AutomatedDecisionEligibility> {
  const rows = await loadAuthorizationGateRows(
    supabase,
    organizationId,
    [candidateId],
  );
  const activeRow = rows.find(row => row.isActive);
  if (!activeRow) {
    return { allowed: false, reason: 'authorization_missing' };
  }
  return {
    ...evaluateAutomatedDecisionEligibility(activeRow),
    externalProcessors: activeRow.externalProcessors,
  };
}

export async function getProcessableAuthorizationContext(
  supabase: TenantSupabaseClient,
  organizationId: string,
  candidateId: string,
): Promise<ProcessableAuthorizationContext> {
  const rows = await loadAuthorizationGateRows(
    supabase,
    organizationId,
    [candidateId],
  );
  const activeRow = rows.find(row => row.isActive);
  return {
    processable: activeRow ? isAuthorizationProcessable(activeRow) : false,
    externalProcessors: activeRow?.externalProcessors ?? [],
  };
}

export function automatedDecisionBlockMessage(
  reason: AutomatedDecisionEligibility['reason'],
): string {
  switch (reason) {
    case 'authorization_missing':
      return '候选人没有有效授权记录，不能进行自动化匹配';
    case 'authorization_unverified':
      return '候选人的授权证据尚未核验，不能进行自动化匹配';
    case 'authorization_expired':
      return '候选人的个人信息处理期限已届满，不能继续匹配';
    case 'human_review_only':
      return '候选人已拒绝自动化辅助匹配，请改为人工评估';
    case 'decision_notice_missing':
      return '授权证据未记录自动化决策告知，不能进行自动化匹配';
    case 'impact_assessment_missing':
      return '未关联已完成的个人信息保护影响评估，不能进行自动化匹配';
    case 'allowed':
      return '';
  }
}

async function loadAuthorizationGateRows(
  supabase: TenantSupabaseClient,
  organizationId: string,
  candidateIds?: string[],
): Promise<AuthorizationGateRow[]> {
  if (candidateIds && candidateIds.length === 0) {
    return [];
  }

  let query = supabase
    .from('authorization_records')
    .select([
      'candidate_id',
      'authorized_at',
      'processing_expires_at',
      'is_active',
      'evidence_status',
      'automated_decision_disclosed',
      'automated_decision_preference',
      'automated_decision_objected_at',
      'impact_assessment_reference',
      'impact_assessment_completed_at',
      'external_processors',
    ].join(','))
    .eq('organization_id', organizationId)
    .order('authorized_at', { ascending: false });

  if (candidateIds) {
    query = query.in('candidate_id', candidateIds);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`查询授权证据失败: ${error.message}`);
  }

  const seenCandidateIds = new Set<string>();
  const rows: AuthorizationGateRow[] = [];
  for (const rawRow of data ?? []) {
    if (!isRecord(rawRow) || typeof rawRow.candidate_id !== 'string') {
      continue;
    }
    if (seenCandidateIds.has(rawRow.candidate_id)) {
      continue;
    }
    seenCandidateIds.add(rawRow.candidate_id);
    rows.push({
      candidateId: rawRow.candidate_id,
      authorizedAt: nullableString(rawRow.authorized_at),
      processingExpiresAt: nullableString(rawRow.processing_expires_at),
      isActive: rawRow.is_active === true,
      evidenceStatus: nullableString(rawRow.evidence_status),
      automatedDecisionDisclosed:
        rawRow.automated_decision_disclosed === true,
      automatedDecisionPreference: nullableString(
        rawRow.automated_decision_preference,
      ),
      automatedDecisionObjectedAt: nullableString(
        rawRow.automated_decision_objected_at,
      ),
      impactAssessmentReference: nullableString(
        rawRow.impact_assessment_reference,
      ),
      impactAssessmentCompletedAt: nullableString(
        rawRow.impact_assessment_completed_at,
      ),
      externalProcessors: stringArray(rawRow.external_processors),
    });
  }
  return rows;
}

export function evaluateAutomatedDecisionEligibility(
  row: AuthorizationGateRow,
): AutomatedDecisionEligibility {
  if (!row.isActive) {
    return { allowed: false, reason: 'authorization_missing' };
  }
  if (row.evidenceStatus !== 'verified') {
    return { allowed: false, reason: 'authorization_unverified' };
  }
  if (!hasCurrentProcessingWindow(row)) {
    return { allowed: false, reason: 'authorization_expired' };
  }
  if (
    row.automatedDecisionPreference === 'human_review_only'
    || row.automatedDecisionObjectedAt
  ) {
    return { allowed: false, reason: 'human_review_only' };
  }
  if (!row.automatedDecisionDisclosed) {
    return { allowed: false, reason: 'decision_notice_missing' };
  }
  if (
    row.automatedDecisionPreference !== 'assistive'
    || !row.impactAssessmentReference
    || !row.impactAssessmentCompletedAt
    || Date.parse(row.impactAssessmentCompletedAt) > Date.now()
  ) {
    return { allowed: false, reason: 'impact_assessment_missing' };
  }
  return { allowed: true, reason: 'allowed' };
}

function isAuthorizationProcessable(row: AuthorizationGateRow): boolean {
  return row.isActive
    && row.evidenceStatus === 'verified'
    && hasCurrentProcessingWindow(row);
}

function hasCurrentProcessingWindow(row: AuthorizationGateRow): boolean {
  if (!row.authorizedAt || !row.processingExpiresAt) {
    return false;
  }
  const now = Date.now();
  return Date.parse(row.authorizedAt) <= now
    && Date.parse(row.processingExpiresAt) > now;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
