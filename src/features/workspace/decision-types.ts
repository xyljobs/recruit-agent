export type ShortlistDecision = 'unreviewed' | 'accepted' | 'needs_information' | 'overridden';

export interface ShortlistEvidence {
  criterion_id: string;
  dimension: string;
  finding: string;
  support_level: 'supported' | 'partial' | 'missing' | 'conflicting';
  candidate_source_path: string | null;
  candidate_excerpt: string | null;
  job_source_path: string | null;
  job_excerpt: string | null;
}

export interface ShortlistEntry {
  id: string;
  shortlist_run_id: string;
  match_record_id: string | null;
  candidate_id: string;
  rank: number;
  recommendation_band: 'strong' | 'consider' | 'insufficient_information';
  confidence_score: number;
  confidence_breakdown: Record<string, number>;
  evidence_snapshot: ShortlistEvidence[];
  missing_information: string[];
  human_decision: ShortlistDecision;
  override_reason_code: string | null;
  override_note: string | null;
  reviewed_at: string | null;
  overall_score?: number | null;
  score_breakdown?: Record<string, number | null> | null;
  match_details?: {
    strengths?: string[];
    gaps?: string[];
    recommendations?: string;
    skill_analysis?: { matched?: string[]; missing?: string[]; bonus_matched?: string[] };
    llm_supplement?: { summary?: string; evidence?: Array<{ dimension: string; finding: string; source: string }> };
  } | null;
  candidate?: {
    id: string;
    name: string;
    current_position?: string | null;
    current_company?: string | null;
    experience_years?: number | null;
    verified_experience_years?: number | null;
    experience_years_status?: 'confirmed' | 'partial' | 'unknown' | null;
    education?: string | null;
    skills?: string[] | null;
    authorization?: {
      source_type?: string | null;
      authorized_at?: string | null;
      processing_expires_at?: string | null;
      is_active?: boolean;
      evidence_status?: string | null;
      automated_decision_objected_at?: string | null;
    } | null;
  } | null;
}

export interface ShortlistRun {
  id: string;
  job_id: string;
  status: string;
  candidate_count: number;
  top_n: number;
  requested_at: string;
  completed_at: string | null;
  qualified_at: string | null;
  job?: { id: string; title: string; department?: string | null } | null;
  entries: ShortlistEntry[];
}

export interface IntegrationConnection {
  id: string;
  name: string;
  connection_type: string;
  status: string;
  enabled: boolean;
  data_boundary_mode?: string | null;
  model_endpoint_classification?: string | null;
  external_processors?: string[] | null;
  last_sync_at?: string | null;
  last_sync_status?: string | null;
  last_sync_error?: string | null;
  last_sync_cursor?: string | null;
}
