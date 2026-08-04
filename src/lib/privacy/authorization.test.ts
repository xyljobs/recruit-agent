import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizationSubmissionSchema,
  buildAuthorizationEvidence,
  type AuthorizationSubmission,
} from './authorization';
import {
  evaluateAutomatedDecisionEligibility,
  type AuthorizationGateRow,
} from './authorization-access';

function validSubmission(
  overrides: Partial<AuthorizationSubmission> = {},
): AuthorizationSubmission {
  const now = Date.now();
  return {
    confirmed: true,
    source_type: 'email',
    source_reference: 'message-id:consent-001',
    proof_type: 'email_confirmation',
    proof_reference: 'compliance-vault/consent-001',
    proof_sha256: '',
    controller_name: '示例招聘组织',
    controller_contact: 'privacy@example.test',
    authorized_at: new Date(now - 60_000).toISOString(),
    processing_expires_at: new Date(
      now + 365 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    external_processors: [
      '示例云服务（候选人数据存储）',
      '示例模型服务（去标识化匹配说明）',
    ],
    automated_decision_preference: 'assistive',
    impact_assessment_reference: 'PIA-CANDIDATE-MATCHING-V1',
    impact_assessment_completed_at: new Date(
      now - 24 * 60 * 60 * 1000,
    ).toISOString(),
    ...overrides,
  };
}

test('rejects the former default-checkbox authorization pattern', () => {
  const result = authorizationSubmissionSchema.safeParse({
    confirmed: true,
  });

  assert.equal(result.success, false);
  if (!result.success) {
    const paths = result.error.issues.map(issue => issue.path.join('.'));
    assert.equal(paths.includes('source_type'), true);
    assert.equal(paths.includes('proof_reference'), true);
    assert.equal(paths.includes('processing_expires_at'), true);
    assert.equal(paths.includes('external_processors'), true);
  }
});

test('requires a completed impact assessment for automated assistance', () => {
  const result = authorizationSubmissionSchema.safeParse(validSubmission({
    impact_assessment_reference: '',
    impact_assessment_completed_at: '',
  }));

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(
      result.error.issues.some(
        issue => issue.path[0] === 'impact_assessment_reference',
      ),
      true,
    );
  }
});

test('allows a candidate to refuse automated matching without a PIA link', () => {
  const result = authorizationSubmissionSchema.safeParse(validSubmission({
    automated_decision_preference: 'human_review_only',
    impact_assessment_reference: '',
    impact_assessment_completed_at: '',
  }));

  assert.equal(result.success, true);
});

test('creates a stable, tamper-evident notice and evidence chain', () => {
  const submission = authorizationSubmissionSchema.parse(validSubmission());
  const context = {
    userAgent: 'test-agent',
    forwardedFor: '192.0.2.10',
  };
  const first = buildAuthorizationEvidence(
    submission,
    '00000000-0000-4000-8000-000000000001',
    context,
  );
  const second = buildAuthorizationEvidence(
    submission,
    '00000000-0000-4000-8000-000000000001',
    context,
  );
  const changed = buildAuthorizationEvidence(
    {
      ...submission,
      source_reference: 'message-id:consent-002',
    },
    '00000000-0000-4000-8000-000000000001',
    context,
  );

  assert.equal(first.notice_text_sha256, second.notice_text_sha256);
  assert.equal(first.evidence_sha256, second.evidence_sha256);
  assert.notEqual(first.evidence_sha256, changed.evidence_sha256);
  assert.equal(first.evidence_status, 'verified');
  assert.equal(first.automated_decision_disclosed, true);
  assert.equal(first.evidence_sha256.length, 64);
});

test('automated matching gate enforces refusal, expiry, and PIA evidence', () => {
  const now = Date.now();
  const allowedRow: AuthorizationGateRow = {
    candidateId: 'candidate-1',
    authorizedAt: new Date(now - 60_000).toISOString(),
    processingExpiresAt: new Date(now + 60_000).toISOString(),
    isActive: true,
    evidenceStatus: 'verified',
    automatedDecisionDisclosed: true,
    automatedDecisionPreference: 'assistive',
    automatedDecisionObjectedAt: null,
    impactAssessmentReference: 'PIA-1',
    impactAssessmentCompletedAt: new Date(now - 60_000).toISOString(),
    externalProcessors: ['processor-a'],
  };

  assert.deepEqual(evaluateAutomatedDecisionEligibility(allowedRow), {
    allowed: true,
    reason: 'allowed',
  });
  assert.equal(
    evaluateAutomatedDecisionEligibility({
      ...allowedRow,
      automatedDecisionObjectedAt: new Date(now).toISOString(),
    }).reason,
    'human_review_only',
  );
  assert.equal(
    evaluateAutomatedDecisionEligibility({
      ...allowedRow,
      processingExpiresAt: new Date(now - 1).toISOString(),
    }).reason,
    'authorization_expired',
  );
  assert.equal(
    evaluateAutomatedDecisionEligibility({
      ...allowedRow,
      impactAssessmentReference: null,
    }).reason,
    'impact_assessment_missing',
  );
});
