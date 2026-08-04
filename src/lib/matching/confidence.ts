export const CONFIDENCE_FORMULA_VERSION = 'confidence-v1';

export const CONFIDENCE_COMPONENT_WEIGHTS = {
  jd_completeness: 25,
  candidate_completeness: 30,
  evidence_coverage: 35,
  data_freshness: 10,
} as const;

export const CONFIDENCE_CAP_REASONS = [
  'missing_resume_text',
  'critical_fact_conflict',
] as const;

export type ConfidenceCapReason = typeof CONFIDENCE_CAP_REASONS[number];
export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface ConfidenceInput {
  /** Percentage of complete JD evaluation criteria, from 0 to 100. */
  jd_completeness: number;
  /** Percentage of complete candidate key fields, from 0 to 100. */
  candidate_completeness: number;
  /** Percentage of required criteria supported by evidence, from 0 to 100. */
  evidence_coverage: number;
  /** Candidate or source updated_at timestamp. Missing/invalid values earn zero. */
  updated_at?: Date | string | null;
  resume_text?: string | null;
  has_critical_conflicts?: boolean;
  /** Injectable reference time for deterministic calculation and tests. */
  now?: Date | string;
  missing_information?: readonly string[];
}

export interface ConfidenceBreakdown {
  jd_completeness: number;
  candidate_completeness: number;
  evidence_coverage: number;
  data_freshness: number;
}

export interface ConfidenceResult {
  confidence_score: number;
  confidence_level: ConfidenceLevel;
  confidence_formula_version: typeof CONFIDENCE_FORMULA_VERSION;
  confidence_breakdown: ConfidenceBreakdown;
  missing_information: string[];
  cap_reasons: ConfidenceCapReason[];
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Measures evidence sufficiency, not candidate quality. Input completeness
 * values are percentages and the returned breakdown is an integer snapshot.
 */
export function calculateConfidence(input: ConfidenceInput): ConfidenceResult {
  const now = parseDate(input.now ?? new Date());
  const updatedAt = parseDate(input.updated_at);
  const breakdown: ConfidenceBreakdown = {
    jd_completeness: normalizePercentage(input.jd_completeness),
    candidate_completeness: normalizePercentage(input.candidate_completeness),
    evidence_coverage: normalizePercentage(input.evidence_coverage),
    data_freshness: calculateFreshness(updatedAt, now),
  };

  let confidenceScore = Math.round(
    breakdown.jd_completeness
      * (CONFIDENCE_COMPONENT_WEIGHTS.jd_completeness / 100)
    + breakdown.candidate_completeness
      * (CONFIDENCE_COMPONENT_WEIGHTS.candidate_completeness / 100)
    + breakdown.evidence_coverage
      * (CONFIDENCE_COMPONENT_WEIGHTS.evidence_coverage / 100)
    + breakdown.data_freshness
      * (CONFIDENCE_COMPONENT_WEIGHTS.data_freshness / 100),
  );

  const capReasons: ConfidenceCapReason[] = [];
  const missingInformation = uniqueNonEmpty(input.missing_information ?? []);
  if (breakdown.jd_completeness < 100) {
    missingInformation.push('JD评估标准不完整');
  }
  if (breakdown.candidate_completeness < 100) {
    missingInformation.push('候选人关键字段不完整');
  }
  if (breakdown.evidence_coverage < 100) {
    missingInformation.push('必需标准证据覆盖不足');
  }
  if (!updatedAt) {
    missingInformation.push('缺少有效的数据更新时间');
  } else if (breakdown.data_freshness === 0) {
    missingInformation.push('数据已超过新鲜度期限');
  }

  if (!input.resume_text?.trim()) {
    confidenceScore = Math.min(confidenceScore, 60);
    capReasons.push('missing_resume_text');
    missingInformation.push('缺少简历正文');
  }
  if (input.has_critical_conflicts === true) {
    confidenceScore = Math.min(confidenceScore, 50);
    capReasons.push('critical_fact_conflict');
    missingInformation.push('关键信息存在冲突，需人工核验');
  }

  return {
    confidence_score: confidenceScore,
    confidence_level: confidenceLevel(confidenceScore),
    confidence_formula_version: CONFIDENCE_FORMULA_VERSION,
    confidence_breakdown: breakdown,
    missing_information: uniqueNonEmpty(missingInformation),
    cap_reasons: capReasons,
  };
}

function calculateFreshness(updatedAt: Date | null, now: Date | null): number {
  if (!updatedAt || !now) {
    return 0;
  }

  const ageInDays = Math.max(0, (now.getTime() - updatedAt.getTime()) / DAY_IN_MS);
  if (ageInDays <= 30) return 100;
  if (ageInDays <= 90) return 75;
  if (ageInDays <= 180) return 50;
  if (ageInDays <= 365) return 25;
  return 0;
}

function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

function normalizePercentage(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}
