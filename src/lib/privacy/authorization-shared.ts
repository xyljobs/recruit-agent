export const AUTHORIZATION_NOTICE_VERSION = 'candidate-processing-v2.0';

export const AUTHORIZATION_PURPOSE =
  '候选人信息管理、职位匹配、招聘沟通及招聘流程跟进';

export const AUTHORIZATION_SOURCE_TYPES = [
  'candidate_portal',
  'email',
  'paper',
  'recruitment_platform',
  'other',
] as const;

export const AUTHORIZATION_PROOF_TYPES = [
  'portal_log',
  'email_confirmation',
  'signed_document',
  'platform_record',
  'other',
] as const;

export const AUTOMATED_DECISION_PREFERENCES = [
  'assistive',
  'human_review_only',
] as const;

export type AuthorizationSourceType =
  (typeof AUTHORIZATION_SOURCE_TYPES)[number];
export type AuthorizationProofType =
  (typeof AUTHORIZATION_PROOF_TYPES)[number];
export type AutomatedDecisionPreference =
  (typeof AUTOMATED_DECISION_PREFERENCES)[number];
