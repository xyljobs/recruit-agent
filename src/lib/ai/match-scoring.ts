import { z } from 'zod';
import { BOUNDARY_CODES, HARD_CONSTRAINT_CODES } from '@/lib/matching/verdict';

export const MATCH_SCORING_INPUT_VERSION = 'match-scoring-input-v3';

const supplementTextSchema = z.string().trim().min(1).max(1000);
const scoreSchema = z.number().int().min(0).max(100);
const detailTextSchema = z.string().trim().min(1).max(10_000);
const hardConstraintViolationSchema = z.object({
  code: z.enum(HARD_CONSTRAINT_CODES),
  reason: z.string().trim().min(1).max(500),
}).strict();
const boundaryFlagSchema = z.object({
  code: z.enum(BOUNDARY_CODES),
  label: z.string().trim().min(1).max(100),
}).strict();

export const baseMatchScoreSchema = z.object({
  overall_score: scoreSchema,
  skill_score: scoreSchema,
  experience_score: scoreSchema,
  education_score: scoreSchema,
  salary_score: scoreSchema,
  location_score: scoreSchema,
  availability_score: scoreSchema,
  stability_score: scoreSchema,
  hard_constraints: z.array(hardConstraintViolationSchema).max(10).optional(),
  boundary_flags: z.array(boundaryFlagSchema).max(10).optional(),
    match_details: z.object({
    strengths: z.array(detailTextSchema).max(20),
    gaps: z.array(detailTextSchema).max(20),
    recommendations: detailTextSchema,
    skill_analysis: z.object({
      matched: z.array(z.string().trim().min(1).max(100)).max(100),
      missing: z.array(z.string().trim().min(1).max(100)).max(100),
      bonus_matched: z.array(z.string().trim().min(1).max(100)).max(100),
    }).strict(),
    salary_analysis: z.object({
      candidate_expectation: z.string().trim().min(1).max(100),
      job_range: z.string().trim().min(1).max(100),
      overlap: z.enum(['有交集', '无交集']),
    }).strict(),
      location_analysis: z.object({
      candidate_city: z.string().trim().min(1).max(100),
      job_city: z.string().trim().min(1).max(100),
      match: z.boolean(),
      }).strict(),
      constraint_analysis: z.object({
        hard_constraints: z.array(hardConstraintViolationSchema).max(10),
        boundary_flags: z.array(boundaryFlagSchema).max(10),
      }).strict().optional(),
      manufacturing_analysis: z.object({
        role_id: z.enum(['MFG-PLC-V1', 'MFG-ROB-V1', 'MFG-MNT-V1']),
        standard_version: z.literal('manufacturing-frozen-v1'),
        hard_fail: z.boolean(),
        hard_gates: z.array(z.object({
          code: z.string().trim().min(1).max(20),
          name: detailTextSchema,
          result: z.enum(['PASS', 'FAIL', 'UNKNOWN']),
          evidence: z.array(detailTextSchema).max(10),
        }).strict()).max(10),
        criteria: z.array(z.object({
          code: z.string().trim().min(1).max(20),
          name: detailTextSchema,
          weight: z.number().int().min(0).max(100),
          score: scoreSchema,
          evidence: z.array(detailTextSchema).max(10),
        }).strict()).max(20),
        total_score: scoreSchema,
        experience_review: z.object({
          status: z.enum(['confirmed', 'provided', 'partial', 'unknown']),
          years: z.number().min(0).max(100).nullable(),
          source: detailTextSchema,
          evidence: detailTextSchema.nullable(),
        }).strict(),
        pending_business_checks: z.array(detailTextSchema).max(10),
      }).strict().optional(),
    }).strict(),
}).strict();

export const matchLlmSupplementSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  evidence: z.array(
    z.object({
      dimension: z.enum(['技能', '经验', '薪资', '地域', '到岗', '稳定性']),
      finding: supplementTextSchema,
      source: supplementTextSchema,
    }).strict(),
  ).max(5),
}).strict();

const generatedSupplementSchema: Record<string, unknown> = {
  ...z.toJSONSchema(matchLlmSupplementSchema, { target: 'draft-07' }),
};
Reflect.deleteProperty(generatedSupplementSchema, '$schema');

export const MATCH_LLM_SUPPLEMENT_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'candidate_match_explanation',
    strict: true,
    schema: generatedSupplementSchema,
  },
};

export interface MatchScoringInput {
  input_version: typeof MATCH_SCORING_INPUT_VERSION;
  job: {
    title: string;
    location: string;
    salary_range: string;
    salary_min: number | null;
    salary_max: number | null;
    skills_required: string[];
    bonus_skills: string[];
    experience_required: string;
    education_required: string;
    responsibilities: string[];
    urgency: string;
  };
  candidate: {
    skills: string[];
    experience_years: number | null;
    education: string;
    current_city: string;
    preferred_locations: string[];
    salary_expectation: string;
    salary_min: number | null;
    salary_max: number | null;
    availability: string;
    job_change_frequency: number | null;
  };
  references: {
    skills_knowledge: string;
    industry_knowledge: string;
  };
}

export function buildMatchScoringInput(
  job: Record<string, unknown>,
  candidate: Record<string, unknown>,
  references: {
    skillsKnowledge: string;
    industryKnowledge: string;
  },
): MatchScoringInput {
  return {
    input_version: MATCH_SCORING_INPUT_VERSION,
    job: {
      title: toText(job.title, '未知职位', 200),
      location: toText(job.location, '未指定', 100),
      salary_range: toText(job.salary_range, '面议', 50),
      salary_min: toNullableNumber(job.salary_min),
      salary_max: toNullableNumber(job.salary_max),
      skills_required: toTextArray(job.skills_required, 50, 100),
      bonus_skills: toTextArray(job.bonus_skills, 50, 100),
      experience_required: toText(job.experience_required, '未指定', 50),
      education_required: toText(job.education_required, '未指定', 100),
      responsibilities: toTextArray(job.responsibilities, 30, 500),
      urgency: toText(job.urgency, 'normal', 20),
    },
    candidate: {
      skills: toTextArray(candidate.skills, 100, 100),
      experience_years: toNullableNonNegativeNumber(candidate.experience_years),
      education: toText(candidate.education, '未知', 100),
      current_city: toText(candidate.current_city, '未知', 100),
      preferred_locations: toTextArray(candidate.preferred_locations, 30, 100),
      salary_expectation: toText(candidate.salary_expectation, '面议', 50),
      salary_min: toNullableNumber(candidate.salary_min),
      salary_max: toNullableNumber(candidate.salary_max),
      availability: toText(candidate.availability, '未知', 50),
      job_change_frequency: toNullableNonNegativeNumber(candidate.job_change_frequency),
    },
    references: {
      skills_knowledge: toText(references.skillsKnowledge, '暂无技能参考知识', 8000),
      industry_knowledge: toText(references.industryKnowledge, '暂无产业参考知识', 8000),
    },
  };
}

function toText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function toTextArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toNullableNonNegativeNumber(value: unknown): number | null {
  const number = toNullableNumber(value);
  return number === null ? null : Math.max(0, number);
}
