import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatExperienceBand,
  parseExperienceBand,
  parseScreeningRubric,
  scoreExperienceBand,
} from './screening-rubric';
import type { ExperienceBand } from './screening-rubric';

// 组 1：6 种年限文本解析 + 失败返回 null（计划 §4.6-1）
test('parseExperienceBand handles six supported text forms', () => {
  assert.deepEqual(parseExperienceBand('3-5年'), {
    min: 3, preferred_max: 5, hard_max: null, source: 'inferred', hard_max_enabled: false,
  });
  assert.deepEqual(parseExperienceBand('3~5年'), {
    min: 3, preferred_max: 5, hard_max: null, source: 'inferred', hard_max_enabled: false,
  });
  assert.deepEqual(parseExperienceBand('3到5年'), {
    min: 3, preferred_max: 5, hard_max: null, source: 'inferred', hard_max_enabled: false,
  });
  assert.deepEqual(parseExperienceBand('3年以上'), {
    min: 3, preferred_max: null, hard_max: null, source: 'inferred', hard_max_enabled: false,
  });
  assert.deepEqual(parseExperienceBand('5年以内'), {
    min: null, preferred_max: 5, hard_max: 5, source: 'explicit', hard_max_enabled: true,
  });
  assert.deepEqual(parseExperienceBand('不超过6年'), {
    min: null, preferred_max: 6, hard_max: 6, source: 'explicit', hard_max_enabled: true,
  });
});

test('parseExperienceBand returns null for unparseable text', () => {
  assert.equal(parseExperienceBand(''), null);
  assert.equal(parseExperienceBand('面议'), null);
  assert.equal(parseExperienceBand('经验不限'), null);
  assert.equal(parseExperienceBand('若干年'), null);
});

// 组 2：source 两态不影响分数（计划 §4.6-2）
test('scoreExperienceBand ignores band source', () => {
  const explicit: ExperienceBand = {
    min: 3, preferred_max: 5, hard_max: null, source: 'explicit', hard_max_enabled: false,
  };
  const inferred: ExperienceBand = {
    min: 3, preferred_max: 5, hard_max: null, source: 'inferred', hard_max_enabled: false,
  };
  assert.equal(scoreExperienceBand(explicit, 4)?.score, 100);
  assert.equal(scoreExperienceBand(inferred, 4)?.score, 100);
  assert.deepEqual(scoreExperienceBand(explicit, 4), scoreExperienceBand(inferred, 4));
});

// 组 3：五段边界（计划 §4.6-3）
test('scoreExperienceBand five segments at boundaries', () => {
  const band: ExperienceBand = {
    min: 3, preferred_max: 5, hard_max: 6, source: 'explicit', hard_max_enabled: true,
  };
  // 低于下限：years=min-1 → max(20, round(2/3*70)) = 47
  assert.equal(scoreExperienceBand(band, 2)?.score, 47);
  // 下限本身与区间内 → 100
  assert.equal(scoreExperienceBand(band, 3)?.score, 100);
  assert.equal(scoreExperienceBand(band, 5)?.score, 100);
  // 超优先上限但未超硬上限：years=preferred_max+1 → max(70, 100-10)=90 + 边界旗标
  const boundary = scoreExperienceBand(band, 6);
  assert.equal(boundary?.score, 90);
  assert.deepEqual(boundary?.boundary_flags, [{ code: 'experience_boundary', label: '边界' }]);
  assert.equal(boundary?.hard_constraints.length, 0);
  // 超硬上限且启用：years=hard_max+1 → 60 + 硬约束，分数不承担否决职责
  const over = scoreExperienceBand(band, 7);
  assert.equal(over?.score, 60);
  assert.equal(over?.hard_constraints.length, 1);
  assert.equal(over?.hard_constraints[0].code, 'experience_over_hard_max');
});

// 组 4：hard_max_enabled 两态同一 7 年候选人（计划 §4.6-4）
test('scoreExperienceBand hard_max_enabled toggles hard constraint', () => {
  const base = { min: 3, preferred_max: 5, hard_max: 6 } as const;
  const enabled: ExperienceBand = { ...base, source: 'explicit', hard_max_enabled: true };
  const disabled: ExperienceBand = { ...base, source: 'inferred', hard_max_enabled: false };

  const withGate = scoreExperienceBand(enabled, 7);
  assert.equal(withGate?.score, 60);
  assert.equal(withGate?.hard_constraints[0].code, 'experience_over_hard_max');

  const withoutGate = scoreExperienceBand(disabled, 7);
  assert.equal(withoutGate?.score, 80);
  assert.equal(withoutGate?.hard_constraints.length, 0);
  assert.deepEqual(withoutGate?.boundary_flags, [{ code: 'experience_boundary', label: '边界' }]);
});

// 组 4 补充：年限缺失返回 null（由调用方回退旧逻辑）
test('scoreExperienceBand returns null when years unknown', () => {
  const band: ExperienceBand = {
    min: 3, preferred_max: 5, hard_max: null, source: 'explicit', hard_max_enabled: false,
  };
  assert.equal(scoreExperienceBand(band, null), null);
  assert.equal(scoreExperienceBand(band, undefined), null);
  assert.equal(scoreExperienceBand(undefined, 4), null);
  assert.equal(scoreExperienceBand(band, -1), null);
});

// parseScreeningRubric：非法值回退空 rubric（计划 4.2 "解析失败返回空而非 throw"）
test('parseScreeningRubric tolerates invalid payloads', () => {
  assert.deepEqual(parseScreeningRubric(null), {});
  assert.deepEqual(parseScreeningRubric('garbage'), {});
  assert.deepEqual(parseScreeningRubric({ experience_band: { min: 'x' } }), {});
  assert.deepEqual(parseScreeningRubric({
    experience_band: { min: 3, preferred_max: 5, hard_max: null, source: 'explicit', hard_max_enabled: true },
  }), {
    experience_band: { min: 3, preferred_max: 5, hard_max: null, source: 'explicit', hard_max_enabled: true },
  });
});

// 展示文案
test('formatExperienceBand renders band labels', () => {
  assert.equal(formatExperienceBand({ min: 3, preferred_max: 5, hard_max: null, source: 'explicit', hard_max_enabled: false }), '3-5年');
  assert.equal(formatExperienceBand({ min: 3, preferred_max: null, hard_max: null, source: 'explicit', hard_max_enabled: false }), '3年以上');
  assert.equal(formatExperienceBand({ min: null, preferred_max: 5, hard_max: 5, source: 'explicit', hard_max_enabled: true }), '5年以内');
  assert.equal(formatExperienceBand(null), null);
  assert.equal(formatExperienceBand(undefined), null);
});
