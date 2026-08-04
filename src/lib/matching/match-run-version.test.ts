import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMatchInputFingerprint,
  buildMatchRunVersion,
} from './match-run-version';

const job = {
  title: '后端工程师',
  skills_required: ['TypeScript', 'PostgreSQL'],
  raw_jd: '负责招聘系统后端开发',
};

const candidate = {
  skills: ['TypeScript'],
  experience_years: 3,
  resume_text: '三年后端开发经验',
};

function version(
  overrides: Partial<Parameters<typeof buildMatchRunVersion>[0]> = {},
) {
  return buildMatchRunVersion({
    job,
    candidate,
    executionMode: 'single',
    llmModel: 'model-v1',
    llmPromptVersion: 'prompt-v1',
    ...overrides,
  });
}

test('keeps a stable fingerprint for identical matching inputs', () => {
  assert.equal(version().inputFingerprint, version().inputFingerprint);
});

test('invalidates a match when the JD or resume changes', () => {
  assert.notEqual(
    version().inputFingerprint,
    version({ job: { ...job, raw_jd: '更新后的职位描述' } }).inputFingerprint,
  );
  assert.notEqual(
    version().inputFingerprint,
    version({
      candidate: { ...candidate, resume_text: '更新后的候选人简历' },
    }).inputFingerprint,
  );
});

test('invalidates a match when the configured model changes', () => {
  assert.notEqual(
    version().inputFingerprint,
    version({ llmModel: 'model-v2' }).inputFingerprint,
  );
});

test('invalidates a match when score weights change', () => {
  const current = version();
  const baseOptions = {
    executionMode: 'single' as const,
    llmModel: 'model-v1',
    llmPromptVersion: 'prompt-v1',
    jobFingerprint: current.jobFingerprint,
    candidateFingerprint: current.candidateFingerprint,
  };

  assert.notEqual(
    buildMatchInputFingerprint({
      ...baseOptions,
      scoreWeights: { skill: 0.35, experience: 0.25 },
    }),
    buildMatchInputFingerprint({
      ...baseOptions,
      scoreWeights: { skill: 0.4, experience: 0.2 },
    }),
  );
});

test('separates single and batch matching runs', () => {
  assert.notEqual(
    version().inputFingerprint,
    version({
      executionMode: 'batch',
      llmModel: null,
      llmPromptVersion: null,
    }).inputFingerprint,
  );
});
