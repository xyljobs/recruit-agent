import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildVerdictRationale,
  collectHardConstraints,
  deriveMatchVerdict,
  formatExperienceYears,
  type BoundaryFlag,
  type HardConstraintViolation,
  type MatchVerdictInput,
} from './verdict';

function input(overrides: Partial<MatchVerdictInput> = {}): MatchVerdictInput {
  return {
    overall_score: 90,
    confidence_score: 80,
    required_skill_total: 10,
    required_skill_matched: 9,
    hard_constraints: [],
    boundary_flags: [],
    ...overrides,
  };
}

describe('deriveMatchVerdict grade thresholds', () => {
  it('hits A exactly at overall=85 / confidence=70 / coverage=0.8', () => {
    const verdict = deriveMatchVerdict(input({
      overall_score: 85,
      confidence_score: 70,
      required_skill_total: 5,
      required_skill_matched: 4,
    }));
    assert.equal(verdict.grade, 'A');
    assert.equal(verdict.label, 'A，优先面');
  });

  it('misses A when coverage is below 0.8 and falls to A-', () => {
    const verdict = deriveMatchVerdict(input({
      overall_score: 85,
      confidence_score: 70,
      required_skill_total: 5,
      required_skill_matched: 3,
    }));
    assert.equal(verdict.grade, 'A-');
    assert.equal(verdict.label, 'A-，建议面');
  });

  it('hits A- exactly at overall=75 / confidence=60', () => {
    const verdict = deriveMatchVerdict(input({
      overall_score: 75,
      confidence_score: 60,
    }));
    assert.equal(verdict.grade, 'A-');
  });

  it('hits B+ exactly at overall=65', () => {
    const verdict = deriveMatchVerdict(input({ overall_score: 65 }));
    assert.equal(verdict.grade, 'B+');
    assert.equal(verdict.label, 'B+，条件面');
  });

  it('falls to B when overall is below 65', () => {
    const verdict = deriveMatchVerdict(input({ overall_score: 64.9 }));
    assert.equal(verdict.grade, 'B');
    assert.equal(verdict.label, 'B，观察');
  });

  it('falls to insufficient when confidence is 49', () => {
    const verdict = deriveMatchVerdict(input({ confidence_score: 49 }));
    assert.equal(verdict.grade, 'insufficient');
    assert.equal(verdict.label, '信息不足，需补充');
  });

  it('is not insufficient when confidence is 50 and overall is 90', () => {
    const verdict = deriveMatchVerdict(input({ overall_score: 90, confidence_score: 50 }));
    assert.notEqual(verdict.grade, 'insufficient');
    assert.equal(verdict.grade, 'B+');
  });
});

describe('deriveMatchVerdict hard constraints', () => {
  const hardConstraint: HardConstraintViolation = {
    code: 'authorization_inactive',
    reason: '候选人授权已失效，不可继续处理',
  };

  it('always wins over high scores', () => {
    const verdict = deriveMatchVerdict(input({
      overall_score: 95,
      confidence_score: 90,
      hard_constraints: [hardConstraint],
    }));
    assert.equal(verdict.grade, 'not_recommended');
    assert.equal(verdict.label, '不建议推进');
    assert.equal(verdict.rank_display, 'dash');
  });

  it('exposes non-empty reasons and dash rank display', () => {
    const verdict = deriveMatchVerdict(input({
      overall_score: 95,
      confidence_score: 90,
      hard_constraints: [hardConstraint],
    }));
    assert.equal(verdict.reasons.length, 1);
    assert.equal(verdict.reasons[0], hardConstraint.reason);
    assert.equal(verdict.rank_display, 'dash');
  });
});

describe('deriveMatchVerdict edge cases', () => {
  it('treats null overall score as 0 and falls to B', () => {
    const verdict = deriveMatchVerdict(input({ overall_score: null }));
    assert.equal(verdict.grade, 'B');
  });

  it('does not block A when required skill total is 0', () => {
    const verdict = deriveMatchVerdict(input({
      overall_score: 90,
      confidence_score: 80,
      required_skill_total: 0,
      required_skill_matched: 0,
    }));
    assert.equal(verdict.grade, 'A');
  });

  it('keeps grade unchanged when boundary flags are present', () => {
    const flags: BoundaryFlag[] = [{ code: 'experience_boundary', label: '边界' }];
    const verdict = deriveMatchVerdict(input({ boundary_flags: flags }));
    assert.equal(verdict.grade, 'A');
    assert.deepEqual(verdict.boundary_labels, ['边界']);
  });
});

describe('collectHardConstraints', () => {
  const past = '2026-01-01T00:00:00.000Z';
  const future = '2099-01-01T00:00:00.000Z';
  const now = new Date('2026-08-14T00:00:00.000Z');

  it('flags inactive authorization', () => {
    const violations = collectHardConstraints({ authorization_is_active: false }, now);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].code, 'authorization_inactive');
  });

  it('flags expired processing deadline with date in reason', () => {
    const violations = collectHardConstraints({ processing_expires_at: past }, now);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].code, 'authorization_expired');
    assert.match(violations[0].reason, /已于 2026-01-01 到期/);
  });

  it('ignores future processing deadline', () => {
    const violations = collectHardConstraints({ processing_expires_at: future }, now);
    assert.equal(violations.length, 0);
  });

  it('flags automated decision objection', () => {
    const violations = collectHardConstraints({ automated_decision_objected_at: past }, now);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].code, 'automated_decision_objected');
  });

  it('flags required skills missing at 3+ items with coverage below 0.5', () => {
    const violations = collectHardConstraints({
      skill_matched: ['java'],
      skill_missing: ['spring', 'redis', 'mysql'],
    }, now);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].code, 'required_skills_missing');
    assert.match(violations[0].reason, /必需技能缺失 3 项：spring、redis、mysql/);
  });

  it('does not flag skills when only 2 are missing', () => {
    const violations = collectHardConstraints({
      skill_matched: ['java'],
      skill_missing: ['spring', 'redis'],
    }, now);
    assert.equal(violations.length, 0);
  });

  it('does not flag skills when coverage is exactly 0.5', () => {
    const violations = collectHardConstraints({
      skill_matched: ['java', 'spring'],
      skill_missing: ['redis', 'mysql'],
    }, now);
    assert.equal(violations.length, 0);
  });
});

describe('buildVerdictRationale fallback chain', () => {
  it('uses truncated LLM summary and appends pending verification', () => {
    const longSummary = '甲'.repeat(150);
    const rationale = buildVerdictRationale({
      llm_summary: longSummary,
      missing_information: ['学历证明'],
    });
    assert.equal(rationale, `${'甲'.repeat(120)}…；待验证：学历证明`);
  });

  it('assembles local rationale from supported findings, gaps and missing items', () => {
    const rationale = buildVerdictRationale({
      llm_summary: null,
      evidence_findings: [
        { finding: '主导过分布式改造', support_level: 'supported' },
        { finding: '熟悉 Java 并发', support_level: 'partial' },
      ],
      gaps: ['缺少高并发实战证据'],
      missing_information: ['学历证明'],
    });
    assert.equal(rationale, '命中：主导过分布式改造；短板：缺少高并发实战证据；待验证：学历证明');
  });

  it('falls back when all sources are empty', () => {
    const rationale = buildVerdictRationale({
      llm_summary: null,
      evidence_findings: [],
      gaps: [],
      missing_information: [],
    });
    assert.equal(rationale, '证据不足，需补充候选人或职位信息');
  });
});

describe('formatExperienceYears four states', () => {
  it('renders confirmed with verified years', () => {
    assert.deepEqual(formatExperienceYears({
      experience_years_status: 'confirmed',
      verified_experience_years: 4.5,
      experience_years: 5,
    }), { text: '4.5年', badge: '已核验' });
  });

  it('renders partial with verified or self-reported years', () => {
    assert.deepEqual(formatExperienceYears({
      experience_years_status: 'partial',
      verified_experience_years: 3,
    }), { text: '3年', badge: '部分核验' });
    assert.deepEqual(formatExperienceYears({
      experience_years_status: 'partial',
      verified_experience_years: null,
      experience_years: 6,
    }), { text: '6年', badge: '部分核验' });
  });

  it('renders self-reported years with plus suffix', () => {
    assert.deepEqual(formatExperienceYears({
      experience_years_status: 'unknown',
      experience_years: 5,
    }), { text: '5年+', badge: '自述' });
  });

  it('renders dash when everything is empty', () => {
    assert.deepEqual(formatExperienceYears({}), { text: '—', badge: '未提供' });
  });
});
