import type { SupabaseClient } from '@supabase/supabase-js';

export interface MatchRecordIdentity {
  organizationId: string;
  jobId: string;
  candidateId: string;
}

export interface MatchScoringWrite {
  current_run_id?: string | null;
  current_run_version?: number | null;
  match_schema_version?: number | null;
  scoring_input_version?: string | null;
  weights_version?: string | null;
  input_fingerprint?: string | null;
  overall_score?: number | null;
  skill_score?: number | null;
  experience_score?: number | null;
  education_score?: number | null;
  salary_score?: number | null;
  location_score?: number | null;
  availability_score?: number | null;
  stability_score?: number | null;
  culture_fit_score?: number | null;
  match_details?: unknown;
  scoring_status: 'pending' | 'succeeded' | 'failed';
  scoring_error?: string | null;
  scoring_model?: string | null;
  scoring_prompt_version?: string | null;
  scoring_input_snapshot?: unknown;
  llm_status?: 'not_requested' | 'succeeded' | 'failed';
  llm_error?: string | null;
  llm_model?: string | null;
  llm_prompt_version?: string | null;
  updated_at?: string;
}

export interface SavedMatchRecord extends Record<string, unknown> {
  id: string;
  candidate_id: string;
}

export function buildMatchScoringMutation(
  input: MatchScoringWrite,
): Record<string, unknown> {
  return {
    current_run_id: input.current_run_id,
    current_run_version: input.current_run_version,
    match_schema_version: input.match_schema_version,
    scoring_input_version: input.scoring_input_version,
    weights_version: input.weights_version,
    input_fingerprint: input.input_fingerprint,
    overall_score: input.overall_score,
    skill_score: input.skill_score,
    experience_score: input.experience_score,
    education_score: input.education_score,
    salary_score: input.salary_score,
    location_score: input.location_score,
    availability_score: input.availability_score,
    stability_score: input.stability_score,
    culture_fit_score: input.culture_fit_score,
    match_details: input.match_details,
    scoring_status: input.scoring_status,
    scoring_error: input.scoring_error,
    scoring_model: input.scoring_model,
    scoring_prompt_version: input.scoring_prompt_version,
    scoring_input_snapshot: input.scoring_input_snapshot,
    llm_status: input.llm_status,
    llm_error: input.llm_error,
    llm_model: input.llm_model,
    llm_prompt_version: input.llm_prompt_version,
    updated_at: input.updated_at ?? new Date().toISOString(),
  };
}

function requireSavedRecord(value: unknown): SavedMatchRecord {
  if (
    !value
    || typeof value !== 'object'
    || typeof (value as { id?: unknown }).id !== 'string'
    || typeof (value as { candidate_id?: unknown }).candidate_id !== 'string'
  ) {
    throw new Error('保存匹配记录失败: 未返回记录');
  }
  return value as SavedMatchRecord;
}

async function updateExistingMatchRecord(
  supabase: SupabaseClient,
  identity: MatchRecordIdentity,
  mutation: Record<string, unknown>,
): Promise<SavedMatchRecord | null> {
  const { data, error } = await supabase
    .from('match_records')
    .update(mutation)
    .eq('organization_id', identity.organizationId)
    .eq('job_id', identity.jobId)
    .eq('candidate_id', identity.candidateId)
    .select()
    .maybeSingle();
  if (error) {
    throw new Error(`保存匹配记录失败: ${error.message}`);
  }
  return data ? requireSavedRecord(data) : null;
}

/**
 * 评分字段与招聘流程状态分开写入。更新已有记录时绝不发送 status/status_history；
 * 新记录依赖数据库默认的 pending。唯一键并发冲突时重试评分更新。
 */
export async function saveMatchScoring(
  supabase: SupabaseClient,
  identity: MatchRecordIdentity,
  input: MatchScoringWrite,
): Promise<SavedMatchRecord> {
  const mutation = buildMatchScoringMutation(input);
  const existing = await updateExistingMatchRecord(supabase, identity, mutation);
  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .from('match_records')
    .insert({
      organization_id: identity.organizationId,
      job_id: identity.jobId,
      candidate_id: identity.candidateId,
      ...mutation,
    })
    .select()
    .single();
  if (!error) {
    return requireSavedRecord(data);
  }
  if (error.code !== '23505') {
    throw new Error(`保存匹配记录失败: ${error.message}`);
  }

  const concurrentlyInserted = await updateExistingMatchRecord(
    supabase,
    identity,
    mutation,
  );
  if (!concurrentlyInserted) {
    throw new Error('保存匹配记录失败: 唯一键冲突记录不可见');
  }
  return concurrentlyInserted;
}
