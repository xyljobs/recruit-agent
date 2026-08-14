import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBatchShortlistEntries } from '@/lib/matching/batch-shortlist';
import type { BaseMatchScore } from '@/lib/matching/scorer';

const fullJob = {
  title: '后端工程师',
  skills_required: ['TypeScript', 'PostgreSQL'],
  experience_required: '3年以上',
  education_required: '本科',
  salary_range: '20-30K',
  location: '杭州',
  urgency: 'normal',
  responsibilities: ['维护服务'],
  raw_jd: '负责后端服务开发',
  completeness: 100,
};

const details: BaseMatchScore['match_details'] = {
  strengths: ['技能匹配'],
  gaps: [],
  recommendations: '建议人工复核。',
  skill_analysis: {
    matched: ['TypeScript', 'PostgreSQL'],
    missing: [],
    bonus_matched: [],
  },
  salary_analysis: {
    candidate_expectation: '20-30K',
    job_range: '20-30K',
    overlap: '有交集',
  },
  location_analysis: {
    candidate_city: '杭州',
    job_city: '杭州',
    match: true,
  },
  constraint_analysis: {
    hard_constraints: [],
    boundary_flags: [],
  },
};

function score(candidateId: string, overall: number) {
  return {
    candidate_id: candidateId,
    match_record_id: `match-${candidateId}`,
    overall_score: overall,
    skill_score: 90,
    experience_score: 90,
    education_score: 90,
    salary_score: 90,
    location_score: 90,
    availability_score: 90,
    stability_score: 90,
    match_details: details,
  };
}

function hardFailScore(candidateId: string) {
  return {
    ...score(candidateId, 100),
    match_details: {
      ...details,
      manufacturing_analysis: {
        role_id: 'MFG-MNT-V1' as const,
        standard_version: 'manufacturing-frozen-v1' as const,
        hard_fail: true,
        hard_gates: [
          {
            code: 'H2',
            name: '独立故障诊断',
            result: 'FAIL' as const,
            evidence: ['只有设备采购和资产管理证据'],
          },
        ],
        criteria: [],
        total_score: 50,
        experience_review: {
          status: 'confirmed' as const,
          years: 4,
          source: 'HR年限复核',
          evidence: null,
        },
        pending_business_checks: ['工作地点', '薪资期望', '倒班接受性', '到岗时间'],
      },
    },
  };
}

function candidate(id: string, resumeText: string | null = '完整简历正文') {
  return {
    id,
    skills: ['TypeScript', 'PostgreSQL'],
    experience_years: 5,
    education: '本科',
    current_city: '杭州',
    salary_expectation: '20-30K',
    availability: '2weeks',
    job_change_frequency: 0.5,
    resume_text: resumeText,
    updated_at: '2026-07-20T00:00:00.000Z',
  };
}

test('builds deterministic ranked shortlist entries with evidence', () => {
  const entries = buildBatchShortlistEntries({
    job: fullJob,
    candidates: [candidate('b'), candidate('a')],
    scores: [score('b', 88), score('a', 88)],
    top_n: 2,
    now: '2026-08-01T00:00:00.000Z',
  });

  assert.deepEqual(entries.map(entry => entry.candidate_id), ['a', 'b']);
  assert.deepEqual(entries.map(entry => entry.rank), [1, 2]);
  assert.equal(entries[0]?.recommendation_band, 'strong');
  assert.ok((entries[0]?.evidence_snapshot.length ?? 0) >= 6);
  assert.equal('human_decision' in (entries[0] ?? {}), false);
});

test('caps confidence and exposes missing information when resume text is absent', () => {
  const entries = buildBatchShortlistEntries({
    job: fullJob,
    candidates: [candidate('a', null)],
    scores: [score('a', 95)],
    top_n: 1,
    now: '2026-08-01T00:00:00.000Z',
  });

  assert.ok((entries[0]?.confidence_score ?? 100) <= 60);
  assert.ok(entries[0]?.missing_information.includes('缺少简历正文'));
  assert.ok(entries[0]?.missing_information.includes('候选人缺少简历正文'));
});

test('truncates evidence excerpts to 200 Unicode characters', () => {
  const longSkills = Array.from({ length: 220 }, () => '技').join('');
  const entries = buildBatchShortlistEntries({
    job: { ...fullJob, skills_required: [longSkills] },
    candidates: [{ ...candidate('a'), skills: [longSkills] }],
    scores: [score('a', 90)],
    top_n: 1,
    now: '2026-08-01T00:00:00.000Z',
  });

  for (const evidence of entries[0]?.evidence_snapshot ?? []) {
    assert.ok([...(evidence.candidate_excerpt ?? '')].length <= 200);
    assert.ok([...(evidence.job_excerpt ?? '')].length <= 200);
  }
});

test('excludes a manufacturing hard fail before shortlist ranking', () => {
  const entries = buildBatchShortlistEntries({
    job: fullJob,
    candidates: [candidate('eligible'), candidate('hard-fail')],
    scores: [score('eligible', 70), hardFailScore('hard-fail')],
    top_n: 2,
    now: '2026-08-01T00:00:00.000Z',
  });

  assert.deepEqual(entries.map(entry => entry.candidate_id), ['eligible']);
});
