import { z } from 'zod';

export const RECOMMENDATION_BANDS = [
  'strong',
  'consider',
  'insufficient_information',
] as const;

export const SHORTLIST_DECISIONS = [
  'accepted',
  'needs_information',
  'overridden',
] as const;

export const OVERRIDE_REASON_CODES = [
  'missing_context',
  'business_constraint',
  'incorrect_evidence',
  'stale_data',
  'candidate_preference',
  'other',
] as const;

export type RecommendationBand = typeof RECOMMENDATION_BANDS[number];
export type ShortlistDecision = typeof SHORTLIST_DECISIONS[number];
export type OverrideReasonCode = typeof OVERRIDE_REASON_CODES[number];

export interface ShortlistCandidate {
  candidate_id: string;
  overall_score: number;
  confidence_score: number;
}

export type RankedShortlistCandidate<T extends ShortlistCandidate> = T & {
  rank: number;
  recommendation_band: RecommendationBand;
};

export const structuredEvidenceSchema = z.strictObject({
  criterion_id: z.string().trim().min(1).max(200),
  dimension: z.string().trim().min(1).max(100),
  finding: z.string().trim().min(1).max(1000),
  support_level: z.enum(['supported', 'partial', 'missing', 'conflicting']),
  candidate_source_path: z.string().trim().min(1).max(500).nullable(),
  candidate_excerpt: z.string().max(200).nullable(),
  job_source_path: z.string().trim().min(1).max(500).nullable(),
  job_excerpt: z.string().max(200).nullable(),
});

export const evidenceSnapshotSchema = z.array(structuredEvidenceSchema);
export type StructuredEvidence = z.infer<typeof structuredEvidenceSchema>;

const nullableTrimmedText = z.string().trim().max(2000).nullable().optional();

export const shortlistDecisionSchema = z.strictObject({
  decision: z.enum(SHORTLIST_DECISIONS),
  reason_code: z.enum(OVERRIDE_REASON_CODES).nullable().optional(),
  note: nullableTrimmedText,
  client_event_id: z.string().uuid(),
  occurred_at: z.string().trim().refine(
    value => Number.isFinite(Date.parse(value)),
    '时间格式无效',
  ),
}).superRefine((value, context) => {
  if (value.decision === 'overridden' && !value.reason_code) {
    context.addIssue({
      code: 'custom',
      path: ['reason_code'],
      message: '覆盖推荐时必须选择原因',
    });
  }
  if (
    value.decision === 'overridden'
    && value.reason_code === 'other'
    && !value.note
  ) {
    context.addIssue({
      code: 'custom',
      path: ['note'],
      message: '选择其他原因时必须填写说明',
    });
  }
});

export type ShortlistDecisionInput = z.infer<typeof shortlistDecisionSchema>;

export interface DecisionOrderable {
  id: string;
  occurred_at: Date | string;
  recorded_at: Date | string;
}

/**
 * Returns a deterministic Top N without mutating the caller's array.
 * Bands express review priority only and never an employment decision.
 */
export function rankShortlist<T extends ShortlistCandidate>(
  candidates: readonly T[],
  topN: number,
): RankedShortlistCandidate<T>[] {
  const limit = Math.max(0, Math.floor(topN));
  const selected = candidates
    .map((candidate, inputIndex) => ({ candidate, inputIndex }))
    .sort((left, right) => (
      descendingNumber(left.candidate.overall_score, right.candidate.overall_score)
      || descendingNumber(
        left.candidate.confidence_score,
        right.candidate.confidence_score,
      )
      || compareText(left.candidate.candidate_id, right.candidate.candidate_id)
      || left.inputIndex - right.inputIndex
    ))
    .slice(0, limit);
  const strongRankLimit = Math.ceil(selected.length / 3);

  return selected.map(({ candidate }, index) => {
    const rank = index + 1;
    let recommendationBand: RecommendationBand = 'consider';
    if (candidate.confidence_score < 50) {
      recommendationBand = 'insufficient_information';
    } else if (rank <= strongRankLimit) {
      recommendationBand = 'strong';
    }

    return {
      ...candidate,
      rank,
      recommendation_band: recommendationBand,
    };
  });
}

/**
 * Truncates excerpts before strict validation so stored snapshots never expose
 * more than 200 characters from either source.
 */
export function createEvidenceSnapshot(
  evidence: readonly StructuredEvidence[],
): StructuredEvidence[] {
  return evidenceSnapshotSchema.parse(evidence.map(item => ({
    ...item,
    candidate_excerpt: truncateExcerpt(item.candidate_excerpt),
    job_excerpt: truncateExcerpt(item.job_excerpt),
  })));
}

/** Orders decision events by the metrics contract: business time, record time, id. */
export function compareDecisionOrder(
  left: DecisionOrderable,
  right: DecisionOrderable,
): number {
  return compareDate(left.occurred_at, right.occurred_at)
    || compareDate(left.recorded_at, right.recorded_at)
    || compareText(left.id, right.id);
}

export function latestEffectiveDecision<T extends DecisionOrderable>(
  events: readonly T[],
): T | null {
  let latest: T | null = null;
  for (const event of events) {
    if (!latest || compareDecisionOrder(latest, event) < 0) {
      latest = event;
    }
  }
  return latest;
}

function truncateExcerpt(value: string | null): string | null {
  return value === null ? null : [...value].slice(0, 200).join('');
}

function descendingNumber(left: number, right: number): number {
  const normalizedLeft = Number.isFinite(left) ? left : Number.NEGATIVE_INFINITY;
  const normalizedRight = Number.isFinite(right) ? right : Number.NEGATIVE_INFINITY;
  return normalizedRight - normalizedLeft;
}

function compareDate(left: Date | string, right: Date | string): number {
  return toEpoch(left) - toEpoch(right);
}

function toEpoch(value: Date | string): number {
  const epoch = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(epoch) ? epoch : Number.NEGATIVE_INFINITY;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
