/**
 * P1 年限区间口径（计划 §4.2）。
 * 口径 2：年限上限来源 = JD 解析预填 + HR 可改；AI 推断出的上限默认不作为硬门槛，
 * 需 HR 显式勾选才生效。
 * 铁律：分数不承担否决职责——超硬上限时分数给 60 而非 0，否决由硬约束显式表达。
 */
import { z } from 'zod';
import type { BoundaryFlag, HardConstraintViolation } from './verdict';

export interface ExperienceBand {
  min: number | null;
  preferred_max: number | null;
  hard_max: number | null;
  source: 'explicit' | 'inferred';
  hard_max_enabled: boolean;
}

export interface ScreeningRubric {
  experience_band?: ExperienceBand | null;
  capability_priority?: string[];
  bonus_caps?: Array<{ skill: string; max_bonus: number }>;
}

/** 全部字段可选；解析失败返回空 rubric 而非 throw（计划 4.2）。 */
export const screeningRubricSchema = z.object({
  experience_band: z.object({
    min: z.number().int().min(0).max(100).nullable(),
    preferred_max: z.number().int().min(0).max(100).nullable(),
    hard_max: z.number().int().min(0).max(100).nullable(),
    source: z.enum(['explicit', 'inferred']),
    hard_max_enabled: z.boolean(),
  }).strict().optional(),
  capability_priority: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  bonus_caps: z.array(z.object({
    skill: z.string().trim().min(1).max(100),
    max_bonus: z.number().int().min(0).max(100),
  }).strict()).max(20).optional(),
});

export function parseScreeningRubric(value: unknown): ScreeningRubric {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object') return {};
  const result = screeningRubricSchema.safeParse(value);
  return result.success ? result.data : {};
}

/** JD 原文明确写出上限语义（以内/不超过/上限/最多）时才算 explicit（计划 4.2）。 */
const EXPLICIT_UPPER_BOUND = /以内|不超过|上限|最多/;

/**
 * 解析年限区间文本。
 * 支持：`3-5年` / `3~5年` / `3到5年` / `3年以上` / `5年以内` / `不超过6年`；
 * 解析不出返回 `null`。
 */
export function parseExperienceBand(text: string): ExperienceBand | null {
  const sourceText = text.trim();
  if (!sourceText) return null;

  const explicit = EXPLICIT_UPPER_BOUND.test(sourceText);

  // 1) 硬上限表达："不超过6年" / "最多6年" / "上限6年" / "5年以内"
  const hardMaxMatch =
    sourceText.match(/不超过\s*(\d+(?:\.\d+)?)/)
    || sourceText.match(/最多\s*(\d+(?:\.\d+)?)/)
    || sourceText.match(/上限\s*(\d+(?:\.\d+)?)/)
    || sourceText.match(/^(\d+(?:\.\d+)?)\s*年?\s*以内/);
  if (hardMaxMatch) {
    const hardMax = toIntOrNull(hardMaxMatch[1]);
    if (hardMax !== null) {
      return {
        min: null,
        preferred_max: hardMax,
        hard_max: hardMax,
        source: 'explicit',
        hard_max_enabled: true,
      };
    }
  }

  // 2) 区间表达："3-5年" / "3~5年" / "3到5年" / "3至5年"
  const rangeMatch = sourceText.match(
    /^(\d+(?:\.\d+)?)\s*(?:[-~～到至])\s*(\d+(?:\.\d+)?)\s*年/,
  );
  if (rangeMatch) {
    const min = toIntOrNull(rangeMatch[1]);
    const max = toIntOrNull(rangeMatch[2]);
    if (min !== null && max !== null) {
      return {
        min,
        preferred_max: Math.max(min, max),
        hard_max: null,
        source: explicit ? 'explicit' : 'inferred',
        hard_max_enabled: explicit,
      };
    }
  }

  // 3) 下限表达："3年以上" / "5年及以上"
  const minMatch =
    sourceText.match(/^(\d+(?:\.\d+)?)\s*年?\s*以上/)
    || sourceText.match(/^(\d+(?:\.\d+)?)\s*年?\s*及以上/);
  if (minMatch) {
    const min = toIntOrNull(minMatch[1]);
    if (min !== null) {
      return {
        min,
        preferred_max: null,
        hard_max: null,
        source: explicit ? 'explicit' : 'inferred',
        hard_max_enabled: explicit,
      };
    }
  }

  return null;
}

function toIntOrNull(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface ExperienceBandScore {
  score: number;
  hard_constraints: HardConstraintViolation[];
  boundary_flags: BoundaryFlag[];
}

/**
 * 年限区间五段评分（计划 4.2 表）。
 * `band` 缺失或候选人年限未知时返回 `null`，由调用方回退旧逻辑。
 */
export function scoreExperienceBand(
  band: ExperienceBand | null | undefined,
  years: number | null | undefined,
): ExperienceBandScore | null {
  if (!band) return null;
  if (years === null || years === undefined || !Number.isFinite(years) || years < 0) {
    return null;
  }

  const min = band.min;
  const preferred = band.preferred_max;
  const hardMax = band.hard_max;

  // 低于下限：随年限比例给分
  if (min !== null && years < min) {
    return {
      score: Math.max(20, Math.round((years / min) * 70)),
      hard_constraints: [],
      boundary_flags: [],
    };
  }

  // 超过硬上限：先判硬约束（启用时），再落边界档
  if (hardMax !== null && years > hardMax) {
    if (band.hard_max_enabled) {
      return {
        score: 60,
        hard_constraints: [{
          code: 'experience_over_hard_max',
          reason: `年限 ${formatYears(years)} 年 > 岗位硬上限 ${formatYears(hardMax)} 年`,
        }],
        boundary_flags: [],
      };
    }
    const base = preferred ?? hardMax;
    return {
      score: Math.max(70, 100 - (years - base) * 10),
      hard_constraints: [],
      boundary_flags: [{ code: 'experience_boundary', label: '边界' }],
    };
  }

  // 超过优先上限（含未启用硬上限时的区间外）：边界档
  if (preferred !== null && years > preferred) {
    return {
      score: Math.max(70, 100 - (years - preferred) * 10),
      hard_constraints: [],
      boundary_flags: [{ code: 'experience_boundary', label: '边界' }],
    };
  }

  // 区间内（或无上限要求）
  return { score: 100, hard_constraints: [], boundary_flags: [] };
}

function formatYears(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** 年限区间展示文案，如 `3-5年`；无区间时返回 null。 */
export function formatExperienceBand(band: ExperienceBand | null | undefined): string | null {
  if (!band) return null;
  const parts: string[] = [];
  if (band.min !== null) {
    parts.push(band.preferred_max !== null
      ? `${formatYears(band.min)}-${formatYears(band.preferred_max)}年`
      : `${formatYears(band.min)}年以上`);
  } else if (band.hard_max !== null) {
    parts.push(`${formatYears(band.hard_max)}年以内`);
  } else {
    return null;
  }
  return parts[0];
}
