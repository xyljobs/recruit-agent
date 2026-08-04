import {
  calculateConfidence,
  type ConfidenceBreakdown,
} from '@/lib/matching/confidence';
import {
  createEvidenceSnapshot,
  rankShortlist,
  type RecommendationBand,
  type StructuredEvidence,
} from '@/lib/matching/shortlist';
import type { MatchDetails } from '@/lib/matching/scorer';

interface BatchShortlistScore {
  candidate_id: string;
  match_record_id: string | null;
  overall_score: number;
  skill_score: number;
  experience_score: number;
  education_score: number;
  salary_score: number;
  location_score: number;
  availability_score: number;
  stability_score: number;
  match_details: MatchDetails;
}

export interface BatchShortlistEntry {
  candidate_id: string;
  match_record_id: string | null;
  rank: number;
  recommendation_band: RecommendationBand;
  confidence_score: number;
  confidence_breakdown: ConfidenceBreakdown;
  evidence_snapshot: StructuredEvidence[];
  missing_information: string[];
}

export interface BuildBatchShortlistInput {
  job: Record<string, unknown>;
  candidates: readonly Record<string, unknown>[];
  scores: readonly BatchShortlistScore[];
  top_n: number;
  now?: Date | string;
}

interface CriterionDefinition {
  id: string;
  dimension: string;
  score: number;
  job_path: string;
  job_value: unknown;
  candidate_path: string;
  candidate_value: unknown;
  finding: string;
}

/**
 * Converts deterministic match scores into an evidence-backed review queue.
 * The returned band is a review priority only; this function never creates an
 * employment decision or changes a candidate's recruiting status.
 */
export function buildBatchShortlistEntries(
  input: BuildBatchShortlistInput,
): BatchShortlistEntry[] {
  const candidatesById = new Map(input.candidates.map(candidate => [
    textValue(candidate.id),
    candidate,
  ]));

  const prepared = input.scores.map(score => {
    const candidate = candidatesById.get(score.candidate_id) ?? {};
    const criteria = buildCriteria(input.job, candidate, score);
    const configuredCriteria = criteria.filter(criterion => hasValue(criterion.job_value));
    const evidencedCriteria = configuredCriteria.filter(criterion => hasValue(criterion.candidate_value));
    const evidenceCoverage = percentage(evidencedCriteria.length, configuredCriteria.length);
    const evidence = createEvidenceSnapshot(
      criteria
        .filter(criterion => hasValue(criterion.job_value) || hasValue(criterion.candidate_value))
        .map(toStructuredEvidence),
    );
    const candidateMissing = missingCandidateInformation(candidate);
    const jobMissing = missingJobInformation(input.job);
    const confidence = calculateConfidence({
      jd_completeness: numericPercentage(input.job.completeness)
        ?? percentage(7 - jobMissing.length, 7),
      candidate_completeness: percentage(7 - candidateMissing.length, 7),
      evidence_coverage: evidenceCoverage,
      updated_at: dateValue(candidate.updated_at ?? candidate.created_at),
      resume_text: nullableText(candidate.resume_text),
      has_critical_conflicts: candidate.has_critical_conflicts === true,
      now: input.now,
      missing_information: [...jobMissing, ...candidateMissing],
    });

    return {
      candidate_id: score.candidate_id,
      match_record_id: score.match_record_id,
      overall_score: score.overall_score,
      confidence_score: confidence.confidence_score,
      confidence_breakdown: confidence.confidence_breakdown,
      evidence_snapshot: evidence,
      missing_information: confidence.missing_information,
    };
  });

  return rankShortlist(prepared, input.top_n).map(entry => ({
    candidate_id: entry.candidate_id,
    match_record_id: entry.match_record_id,
    rank: entry.rank,
    recommendation_band: entry.recommendation_band,
    confidence_score: entry.confidence_score,
    confidence_breakdown: entry.confidence_breakdown,
    evidence_snapshot: entry.evidence_snapshot,
    missing_information: entry.missing_information,
  }));
}

function buildCriteria(
  job: Record<string, unknown>,
  candidate: Record<string, unknown>,
  score: BatchShortlistScore,
): CriterionDefinition[] {
  const matchedSkills = score.match_details.skill_analysis.matched;
  const missingSkills = score.match_details.skill_analysis.missing;
  return [
    {
      id: 'required-skills',
      dimension: '技能',
      score: score.skill_score,
      job_path: 'job_requirements.skills_required',
      job_value: job.skills_required,
      candidate_path: 'candidates.skills',
      candidate_value: candidate.skills,
      finding: `明确命中 ${listOrUnknown(matchedSkills)}；尚未找到 ${listOrUnknown(missingSkills)}`,
    },
    {
      id: 'experience',
      dimension: '经验',
      score: score.experience_score,
      job_path: 'job_requirements.experience_required',
      job_value: job.experience_required,
      candidate_path: 'candidates.experience_years',
      candidate_value: candidate.experience_years,
      finding: `职位经验要求：${String(job.experience_required ?? '未明确')}；候选人明确年限：${String(candidate.experience_years ?? '未明确')}`,
    },
    {
      id: 'education',
      dimension: '学历',
      score: score.education_score,
      job_path: 'job_requirements.education_required',
      job_value: job.education_required,
      candidate_path: 'candidates.education',
      candidate_value: candidate.education,
      finding: `职位学历要求：${String(job.education_required ?? '未明确')}；候选人学历：${String(candidate.education ?? '未明确')}`,
    },
    {
      id: 'salary',
      dimension: '薪资',
      score: score.salary_score,
      job_path: 'job_requirements.salary_range',
      job_value: firstValue(job.salary_range, rangeValue(job.salary_min, job.salary_max)),
      candidate_path: 'candidates.salary_expectation',
      candidate_value: firstValue(
        candidate.salary_expectation,
        rangeValue(candidate.salary_min, candidate.salary_max),
      ),
      finding: `薪资范围核验：${score.match_details.salary_analysis.overlap}`,
    },
    {
      id: 'location',
      dimension: '地点',
      score: score.location_score,
      job_path: 'job_requirements.location',
      job_value: job.location,
      candidate_path: 'candidates.current_city',
      candidate_value: firstValue(candidate.current_city, candidate.preferred_locations),
      finding: score.match_details.location_analysis.match ? '工作地点信息相符' : '工作地点或候选人意愿需进一步确认',
    },
    {
      id: 'availability',
      dimension: '到岗时间',
      score: score.availability_score,
      job_path: 'job_requirements.urgency',
      job_value: job.urgency,
      candidate_path: 'candidates.availability',
      candidate_value: candidate.availability,
      finding: `候选人到岗信息：${String(candidate.availability ?? '未明确')}`,
    },
    {
      id: 'stability',
      dimension: '稳定性',
      score: score.stability_score,
      job_path: 'job_requirements.title',
      job_value: job.title,
      candidate_path: 'candidates.job_change_frequency',
      candidate_value: candidate.job_change_frequency,
      finding: `候选人工作变动信息：${String(candidate.job_change_frequency ?? '未明确')}`,
    },
  ];
}

function toStructuredEvidence(criterion: CriterionDefinition): StructuredEvidence {
  return {
    criterion_id: criterion.id,
    dimension: criterion.dimension,
    finding: criterion.finding,
    support_level: supportLevel(criterion.score, criterion.candidate_value),
    candidate_source_path: criterion.candidate_path,
    candidate_excerpt: excerpt(criterion.candidate_value),
    job_source_path: criterion.job_path,
    job_excerpt: excerpt(criterion.job_value),
  };
}

function supportLevel(
  score: number,
  candidateValue: unknown,
): StructuredEvidence['support_level'] {
  if (!hasValue(candidateValue)) return 'missing';
  if (score >= 70) return 'supported';
  return 'partial';
}

function missingJobInformation(job: Record<string, unknown>): string[] {
  const fields: Array<[unknown, string]> = [
    [job.skills_required, 'JD缺少必需技能'],
    [job.experience_required, 'JD缺少经验要求'],
    [job.education_required, 'JD缺少学历要求'],
    [firstValue(job.salary_range, rangeValue(job.salary_min, job.salary_max)), 'JD缺少薪资范围'],
    [job.location, 'JD缺少工作地点'],
    [job.responsibilities, 'JD缺少岗位职责'],
    [job.raw_jd, 'JD缺少原始文本'],
  ];
  return fields.filter(([value]) => !hasValue(value)).map(([, label]) => label);
}

function missingCandidateInformation(candidate: Record<string, unknown>): string[] {
  const fields: Array<[unknown, string]> = [
    [candidate.skills, '候选人缺少技能信息'],
    [candidate.experience_years, '候选人缺少经验年限'],
    [candidate.education, '候选人缺少学历信息'],
    [firstValue(candidate.current_city, candidate.preferred_locations), '候选人缺少地点信息'],
    [firstValue(candidate.salary_expectation, rangeValue(candidate.salary_min, candidate.salary_max)), '候选人缺少薪资期望'],
    [candidate.availability, '候选人缺少到岗时间'],
    [candidate.resume_text, '候选人缺少简历正文'],
  ];
  return fields.filter(([value]) => !hasValue(value)).map(([, label]) => label);
}

function percentage(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

function numericPercentage(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasValue);
  return true;
}

function excerpt(value: unknown): string | null {
  if (!hasValue(value)) return null;
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join('、');
  return textValue(value);
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function nullableText(value: unknown): string | null {
  const text = textValue(value);
  return text || null;
}

function dateValue(value: unknown): Date | string | null {
  if (value instanceof Date) return value;
  return typeof value === 'string' ? value : null;
}

function firstValue(...values: unknown[]): unknown {
  return values.find(hasValue);
}

function rangeValue(min: unknown, max: unknown): string | null {
  if (!hasValue(min) && !hasValue(max)) return null;
  return `${textValue(min) || '?'}-${textValue(max) || '?'}`;
}

function listOrUnknown(values: readonly string[]): string {
  return values.length > 0 ? values.join('、') : '无';
}
