import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachLlmSupplement,
  calculateBaseMatchScore,
  parseMatchLlmSupplement,
} from './scorer';

const job = {
  skills_required: ['React', 'TypeScript', 'PostgreSQL'],
  bonus_skills: ['Docker'],
  experience_required: '3-5年',
  education_required: '本科',
  salary_range: '20-30K',
  location: '杭州市',
  urgency: 'normal',
} as const;

const candidate = {
  skills: ['Vue', 'TS', 'MySQL', 'Docker'],
  experience_years: 4,
  education: '硕士',
  salary_expectation: '25-35K',
  current_city: '上海市',
  preferred_locations: ['杭州'],
  availability: '1week',
  job_change_frequency: 0.8,
} as const;

test('shared base scorer returns deterministic, explainable scores', () => {
  const first = calculateBaseMatchScore(job, candidate);
  const second = calculateBaseMatchScore(job, candidate);

  assert.deepEqual(second, first);
  assert.deepEqual(
    {
      overall_score: first.overall_score,
      skill_score: first.skill_score,
      experience_score: first.experience_score,
      education_score: first.education_score,
      salary_score: first.salary_score,
      location_score: first.location_score,
      availability_score: first.availability_score,
      stability_score: first.stability_score,
    },
    {
      overall_score: 87,
      skill_score: 100,
      experience_score: 75,
      education_score: 100,
      salary_score: 80,
      location_score: 85,
      availability_score: 90,
      stability_score: 80,
    },
  );
  assert.deepEqual(first.match_details.skill_analysis, {
    matched: ['React', 'TypeScript', 'PostgreSQL'],
    missing: [],
    bonus_matched: ['Docker'],
  });
});

test('approved future-run weights change only the aggregate calculation', () => {
  const score = calculateBaseMatchScore(
    { skills_required: ['TypeScript'], experience_required: '10年' },
    { skills: ['TypeScript'], experience_years: 1 },
    { SKILL: 1, EXPERIENCE: 0, SALARY: 0, LOCATION: 0, AVAILABILITY: 0, STABILITY: 0 },
  );
  assert.equal(score.overall_score, score.skill_score);
  assert.notEqual(score.skill_score, score.experience_score);
});

test('LLM supplement parser rejects attempted score overrides', () => {
  const supplement = parseMatchLlmSupplement(JSON.stringify({
    overall_score: 100,
    skill_score: 0,
    summary: '基础结论不变，建议核验项目深度。',
    evidence: [
      {
        dimension: '技能',
        finding: '简历提到前端框架项目经验。',
        source: '简历摘要',
      },
    ],
  }));

  assert.equal(supplement, null);

  const base = calculateBaseMatchScore(job, candidate);
  const enriched = attachLlmSupplement(base.match_details, supplement);
  assert.deepEqual(enriched.skill_analysis, base.match_details.skill_analysis);
  assert.equal(enriched.llm_supplement, undefined);
});

test('invalid LLM output leaves base details unchanged', () => {
  const base = calculateBaseMatchScore(job, candidate);
  const supplement = parseMatchLlmSupplement('not-json');

  assert.equal(supplement, null);
  assert.equal(attachLlmSupplement(base.match_details, supplement), base.match_details);
});

test('all deterministic score dimensions stay within 0-100', () => {
  const score = calculateBaseMatchScore(
    {
      skills_required: [],
      experience_required: '20年',
      salary_range: '1-2K',
      location: '杭州',
      urgency: 'urgent',
    },
    {
      skills: [],
      experience_years: -100,
      salary_expectation: '999-1000K',
      current_city: '北京',
      availability: '1month',
      job_change_frequency: 99,
    },
  );

  for (const value of [
    score.overall_score,
    score.skill_score,
    score.experience_score,
    score.education_score,
    score.salary_score,
    score.location_score,
    score.availability_score,
    score.stability_score,
  ]) {
    assert.equal(Number.isInteger(value), true);
    assert.equal(value >= 0 && value <= 100, true);
  }
});

test('normalizes fractional inputs to integer scores', () => {
  const score = calculateBaseMatchScore(
    {
      salary_min: 20.25,
      salary_max: 30.75,
    },
    {
      salary_min: 28.5,
      salary_max: 35.5,
    },
  );

  for (const value of [
    score.overall_score,
    score.skill_score,
    score.experience_score,
    score.education_score,
    score.salary_score,
    score.location_score,
    score.availability_score,
    score.stability_score,
  ]) {
    assert.equal(Number.isInteger(value), true);
    assert.equal(value >= 0 && value <= 100, true);
  }
});
