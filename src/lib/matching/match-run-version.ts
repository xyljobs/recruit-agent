import { createHash } from 'node:crypto';
import { MATCH_SCORING_INPUT_VERSION } from '@/lib/ai/match-scoring';
import {
  BASE_SCORING_MODEL,
  SCORE_WEIGHTS,
  type MatchScoreWeights,
} from '@/lib/matching/scorer';

export const MATCH_RUN_SCHEMA_VERSION = 1;
export const MATCH_WEIGHTS_VERSION = 'match-weights-v1';

export type MatchExecutionMode = 'single' | 'batch';

interface MatchRunVersionOptions {
  job: Record<string, unknown>;
  candidate: Record<string, unknown>;
  executionMode: MatchExecutionMode;
  llmModel: string | null;
  llmPromptVersion: string | null;
  scoreWeights?: MatchScoreWeights;
  weightsVersion?: string;
}

export interface MatchRunVersion {
  schemaVersion: number;
  inputVersion: typeof MATCH_SCORING_INPUT_VERSION;
  scoringModel: typeof BASE_SCORING_MODEL;
  weightsVersion: string;
  jobFingerprint: string;
  candidateFingerprint: string;
  inputFingerprint: string;
}

interface MatchInputFingerprintOptions {
  executionMode: MatchExecutionMode;
  llmModel: string | null;
  llmPromptVersion: string | null;
  jobFingerprint: string;
  candidateFingerprint: string;
  scoreWeights: Record<string, number>;
  weightsVersion?: string;
}

const JOB_VERSION_FIELDS = [
  'title',
  'department',
  'location',
  'salary_range',
  'salary_min',
  'salary_max',
  'experience_required',
  'education_required',
  'skills_required',
  'bonus_skills',
  'responsibilities',
  'urgency',
  'raw_jd',
] as const;

const CANDIDATE_VERSION_FIELDS = [
  'resume_url',
  'skills',
  'experience_years',
  'education',
  'current_company',
  'current_position',
  'current_city',
  'preferred_locations',
  'salary_expectation',
  'salary_min',
  'salary_max',
  'availability',
  'job_change_frequency',
  'work_history',
  'resume_text',
] as const;

export function buildMatchRunVersion({
  job,
  candidate,
  executionMode,
  llmModel,
  llmPromptVersion,
  scoreWeights = SCORE_WEIGHTS,
  weightsVersion = MATCH_WEIGHTS_VERSION,
}: MatchRunVersionOptions): MatchRunVersion {
  const jobFingerprint = hashValue(pickVersionFields(job, JOB_VERSION_FIELDS));
  const candidateFingerprint = hashValue(
    pickVersionFields(candidate, CANDIDATE_VERSION_FIELDS),
  );

  const inputFingerprint = buildMatchInputFingerprint({
    executionMode,
    llmModel,
    llmPromptVersion,
    jobFingerprint,
    candidateFingerprint,
    scoreWeights,
    weightsVersion,
  });

  return {
    schemaVersion: MATCH_RUN_SCHEMA_VERSION,
    inputVersion: MATCH_SCORING_INPUT_VERSION,
    scoringModel: BASE_SCORING_MODEL,
    weightsVersion,
    jobFingerprint,
    candidateFingerprint,
    inputFingerprint,
  };
}

export function buildMatchInputFingerprint({
  executionMode,
  llmModel,
  llmPromptVersion,
  jobFingerprint,
  candidateFingerprint,
  scoreWeights,
  weightsVersion = MATCH_WEIGHTS_VERSION,
}: MatchInputFingerprintOptions): string {
  return hashValue({
    schema_version: MATCH_RUN_SCHEMA_VERSION,
    input_version: MATCH_SCORING_INPUT_VERSION,
    execution_mode: executionMode,
    scoring_model: BASE_SCORING_MODEL,
    weights_version: weightsVersion,
    score_weights: scoreWeights,
    llm_model: llmModel,
    llm_prompt_version: llmPromptVersion,
    job_fingerprint: jobFingerprint,
    candidate_fingerprint: candidateFingerprint,
  });
}

function pickVersionFields(
  record: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(fields.map(field => [field, record[field] ?? null]));
}

function hashValue(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize(value[key])]),
    );
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
