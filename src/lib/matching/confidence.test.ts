import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateConfidence,
  CONFIDENCE_FORMULA_VERSION,
} from './confidence';

const NOW = '2026-08-02T00:00:00.000Z';

test('uses the versioned 25/30/35/10 confidence formula', () => {
  const complete = calculateConfidence({
    jd_completeness: 100,
    candidate_completeness: 100,
    evidence_coverage: 100,
    updated_at: NOW,
    resume_text: '完整简历正文',
    now: NOW,
  });

  assert.deepEqual(complete, {
    confidence_score: 100,
    confidence_level: 'high',
    confidence_formula_version: CONFIDENCE_FORMULA_VERSION,
    confidence_breakdown: {
      jd_completeness: 100,
      candidate_completeness: 100,
      evidence_coverage: 100,
      data_freshness: 100,
    },
    missing_information: [],
    cap_reasons: [],
  });

  const components = [
    calculateConfidence({
      jd_completeness: 100,
      candidate_completeness: 0,
      evidence_coverage: 0,
      updated_at: null,
      resume_text: '简历',
      now: NOW,
    }).confidence_score,
    calculateConfidence({
      jd_completeness: 0,
      candidate_completeness: 100,
      evidence_coverage: 0,
      updated_at: null,
      resume_text: '简历',
      now: NOW,
    }).confidence_score,
    calculateConfidence({
      jd_completeness: 0,
      candidate_completeness: 0,
      evidence_coverage: 100,
      updated_at: null,
      resume_text: '简历',
      now: NOW,
    }).confidence_score,
    calculateConfidence({
      jd_completeness: 0,
      candidate_completeness: 0,
      evidence_coverage: 0,
      updated_at: NOW,
      resume_text: '简历',
      now: NOW,
    }).confidence_score,
  ];
  assert.deepEqual(components, [25, 30, 35, 10]);
});

test('caps missing resume text at 60 and reports the reason', () => {
  const result = calculateConfidence({
    jd_completeness: 100,
    candidate_completeness: 100,
    evidence_coverage: 100,
    updated_at: NOW,
    resume_text: '   ',
    now: NOW,
  });

  assert.equal(result.confidence_score, 60);
  assert.equal(result.confidence_level, 'medium');
  assert.deepEqual(result.cap_reasons, ['missing_resume_text']);
  assert.ok(result.missing_information.includes('缺少简历正文'));
});

test('caps conflicting critical facts at 50 after other caps', () => {
  const result = calculateConfidence({
    jd_completeness: 100,
    candidate_completeness: 100,
    evidence_coverage: 100,
    updated_at: NOW,
    resume_text: null,
    has_critical_conflicts: true,
    now: NOW,
  });

  assert.equal(result.confidence_score, 50);
  assert.equal(result.confidence_level, 'low');
  assert.deepEqual(result.cap_reasons, [
    'missing_resume_text',
    'critical_fact_conflict',
  ]);
});

test('missing freshness earns zero and old data expires to zero', () => {
  const missing = calculateConfidence({
    jd_completeness: 100,
    candidate_completeness: 100,
    evidence_coverage: 100,
    updated_at: null,
    resume_text: '简历',
    now: NOW,
  });
  const expired = calculateConfidence({
    jd_completeness: 100,
    candidate_completeness: 100,
    evidence_coverage: 100,
    updated_at: '2025-08-01T00:00:00.000Z',
    resume_text: '简历',
    now: NOW,
  });

  assert.equal(missing.confidence_breakdown.data_freshness, 0);
  assert.equal(missing.confidence_score, 90);
  assert.ok(missing.missing_information.includes('缺少有效的数据更新时间'));
  assert.equal(expired.confidence_breakdown.data_freshness, 0);
  assert.ok(expired.missing_information.includes('数据已超过新鲜度期限'));
});

test('normalizes every score and breakdown value to an integer', () => {
  const result = calculateConfidence({
    jd_completeness: 88.8,
    candidate_completeness: 61.2,
    evidence_coverage: 43.7,
    updated_at: '2026-06-15T00:00:00.000Z',
    resume_text: '简历',
    now: NOW,
  });

  assert.equal(Number.isInteger(result.confidence_score), true);
  for (const component of Object.values(result.confidence_breakdown)) {
    assert.equal(Number.isInteger(component), true);
    assert.equal(component >= 0 && component <= 100, true);
  }
});
