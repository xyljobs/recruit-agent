/**
 * 匹配结论判定（规则层唯一入口）。
 * 等级与"不建议推进"只能由本模块的规则派生，LLM 不得决定等级、
 * 不得输出排序结论或否决建议（口径 6）。
 */

export type MatchGrade = 'A' | 'A-' | 'B+' | 'B' | 'insufficient' | 'not_recommended';

export const HARD_CONSTRAINT_CODES = [
  'authorization_inactive',
  'authorization_expired',
  'automated_decision_objected',
  'required_skills_missing',
  'experience_over_hard_max', // P1 才会被触发
] as const;

export type HardConstraintCode = (typeof HARD_CONSTRAINT_CODES)[number];

export const BOUNDARY_CODES = [
  'experience_boundary',
  'frequent_job_change',
  'cross_city',
] as const;

export type BoundaryCode = (typeof BOUNDARY_CODES)[number];

export interface HardConstraintViolation {
  code: HardConstraintCode;
  reason: string;
}

export interface BoundaryFlag {
  code: BoundaryCode;
  label: string;
}

export interface MatchVerdictInput {
  overall_score: number | null;
  confidence_score: number;
  /**
   * 必需技能覆盖率的分子/分母。
   * 口径：分母取 match_details.skill_analysis 的 matched + missing 之和，
   * 而非职位 skills_required.length（列表接口未透传职位技能清单）。
   * 若 skill_analysis 未覆盖全部必需技能，覆盖率会偏宽松（不误杀）；
   * 如需按职位完整必需技能数计算，需 API 透传 job.skills_required。
   */
  required_skill_total: number;
  required_skill_matched: number;
  hard_constraints: readonly HardConstraintViolation[];
  boundary_flags: readonly BoundaryFlag[];
}

export interface MatchVerdict {
  grade: MatchGrade;
  label: string;              // 展示文案
  tone: string;               // tailwind class 串
  reasons: string[];          // grade='not_recommended' 时必非空
  boundary_labels: string[];
  rank_display: 'rank' | 'dash';   // 'dash' 表示排名列显示 —
}

interface GradeSpec {
  grade: MatchGrade;
  label: string;
  tone: string;
  rankDisplay: 'rank' | 'dash';
}

const NOT_RECOMMENDED_SPEC: GradeSpec = {
  grade: 'not_recommended',
  label: '不建议推进',
  tone: 'border-red-200 bg-red-50 text-red-800',
  rankDisplay: 'dash',
};

/**
 * 等级判定表（严格自上而下，第一个命中即返回，不得调整顺序）。
 * 边界标签独立于等级，不降级，仅追加展示。
 */
export function deriveMatchVerdict(input: MatchVerdictInput): MatchVerdict {
  const overall = input.overall_score ?? 0;
  const coveragePasses = input.required_skill_total === 0
    || input.required_skill_matched / input.required_skill_total >= 0.8;

  let spec: GradeSpec;
  if (input.hard_constraints.length > 0) {
    spec = NOT_RECOMMENDED_SPEC;
  } else if (input.confidence_score < 50) {
    spec = {
      grade: 'insufficient',
      label: '信息不足，需补充',
      tone: 'border-slate-200 bg-slate-50 text-slate-700',
      rankDisplay: 'rank',
    };
  } else if (overall >= 85 && input.confidence_score >= 70 && coveragePasses) {
    spec = {
      grade: 'A',
      label: 'A，优先面',
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      rankDisplay: 'rank',
    };
  } else if (overall >= 75 && input.confidence_score >= 60) {
    spec = {
      grade: 'A-',
      label: 'A-，建议面',
      tone: 'border-blue-200 bg-blue-50 text-blue-800',
      rankDisplay: 'rank',
    };
  } else if (overall >= 65) {
    spec = {
      grade: 'B+',
      label: 'B+，条件面',
      tone: 'border-amber-200 bg-amber-50 text-amber-800',
      rankDisplay: 'rank',
    };
  } else {
    spec = {
      grade: 'B',
      label: 'B，观察',
      tone: 'border-amber-200 bg-amber-50 text-amber-800',
      rankDisplay: 'rank',
    };
  }

  return {
    grade: spec.grade,
    label: spec.label,
    tone: spec.tone,
    reasons: spec.grade === 'not_recommended'
      ? input.hard_constraints.map(constraint => constraint.reason)
      : [],
    boundary_labels: input.boundary_flags.map(flag => flag.label),
    rank_display: spec.rankDisplay,
  };
}

export interface VerdictConstraintSource {
  authorization_is_active?: boolean | null;
  processing_expires_at?: string | null;
  automated_decision_objected_at?: string | null;
  skill_matched?: readonly string[] | null;
  skill_missing?: readonly string[] | null;
}

function formatDatePart(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

/**
 * P0 阶段硬约束来源（数据均已在 /api/shortlists 返回中）。
 * 年限类硬约束（experience_over_hard_max）P1 才会被触发，本函数不产出。
 */
export function collectHardConstraints(
  source: VerdictConstraintSource,
  now: Date = new Date(),
): HardConstraintViolation[] {
  const violations: HardConstraintViolation[] = [];

  if (source.authorization_is_active === false) {
    violations.push({
      code: 'authorization_inactive',
      reason: '候选人授权已失效，不可继续处理',
    });
  }
  if (source.processing_expires_at) {
    const expiresAt = new Date(source.processing_expires_at);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < now.getTime()) {
      violations.push({
        code: 'authorization_expired',
        reason: `候选人处理期限已于 ${formatDatePart(source.processing_expires_at)} 到期`,
      });
    }
  }
  if (source.automated_decision_objected_at) {
    violations.push({
      code: 'automated_decision_objected',
      reason: '候选人已拒绝自动化决策，仅允许人工评估',
    });
  }

  const matched = source.skill_matched?.length ?? 0;
  const missing = source.skill_missing ?? [];
  const total = matched + missing.length;
  if (missing.length >= 3 && total > 0 && matched / total < 0.5) {
    violations.push({
      code: 'required_skills_missing',
      reason: `必需技能缺失 ${missing.length} 项：${missing.slice(0, 3).join('、')}`,
    });
  }

  return violations;
}

export interface VerdictRationaleInput {
  llm_summary?: string | null;
  evidence_findings?: readonly { finding: string; support_level?: string | null }[] | null;
  gaps?: readonly string[] | null;
  missing_information?: readonly string[] | null;
}

const MAX_SUMMARY_LENGTH = 120;

function truncate(text: string, maxLength: number): string {
  const chars = Array.from(text);
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join('')}…` : text;
}

/**
 * "判断依据"列三级降级：
 * 1. 有 LLM 摘要 → 摘要（截断）+ 待验证项；
 * 2. 否则本地拼装 命中/短板/待验证；
 * 3. 两者皆空 → 证据不足兜底文案。
 */
export function buildVerdictRationale(input: VerdictRationaleInput): string {
  const summary = input.llm_summary?.trim();
  const missing = input.missing_information ?? [];
  if (summary) {
    const pending = missing[0] ? `；待验证：${missing[0]}` : '';
    return `${truncate(summary, MAX_SUMMARY_LENGTH)}${pending}`;
  }

  const findings = (input.evidence_findings ?? [])
    .filter(item => item.support_level === 'supported')
    .map(item => item.finding)
    .slice(0, 3);
  const gaps = input.gaps ?? [];
  if (findings.length > 0 || gaps.length > 0 || missing.length > 0) {
    const parts: string[] = [];
    if (findings.length > 0) parts.push(`命中：${findings.join('，')}`);
    parts.push(`短板：${gaps[0] ?? '暂无'}`);
    parts.push(`待验证：${missing[0] ?? '无'}`);
    return parts.join('；');
  }

  return '证据不足，需补充候选人或职位信息';
}

export interface ExperienceDisplayInput {
  experience_years?: number | null;
  verified_experience_years?: number | null;
  experience_years_status?: 'confirmed' | 'partial' | 'unknown' | null;
}

/**
 * 年限列四态展示。
 */
export function formatExperienceYears(input: ExperienceDisplayInput): { text: string; badge: string } {
  const { experience_years, verified_experience_years, experience_years_status } = input;
  if (experience_years_status === 'confirmed' && verified_experience_years != null) {
    return { text: `${verified_experience_years}年`, badge: '已核验' };
  }
  if (experience_years_status === 'partial') {
    const years = verified_experience_years ?? experience_years;
    if (years == null) return { text: '—', badge: '未提供' };
    return { text: `${years}年`, badge: '部分核验' };
  }
  if (experience_years != null) {
    return { text: `${experience_years}年+`, badge: '自述' };
  }
  return { text: '—', badge: '未提供' };
}
