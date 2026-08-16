import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  AUTHORIZATION_NOTICE_VERSION,
  AUTHORIZATION_PROOF_TYPES,
  AUTHORIZATION_PURPOSE,
  AUTHORIZATION_SOURCE_TYPES,
  AUTOMATED_DECISION_PREFERENCES,
} from './authorization-shared';

const dateTimeString = z.string().trim().min(1, '请填写时间').refine(
  value => Number.isFinite(Date.parse(value)),
  '时间格式无效',
);

const optionalDateTimeString = z.string().trim().refine(
  value => value === '' || Number.isFinite(Date.parse(value)),
  '时间格式无效',
);

export const authorizationSubmissionSchema = z.object({
  confirmed: z.boolean().refine(value => value, {
    message: '必须由经办人明确确认候选人已充分知情并自愿授权',
  }),
  source_type: z.enum(AUTHORIZATION_SOURCE_TYPES, {
    error: '请选择授权来源',
  }),
  source_reference: z.string().trim().min(1, '请填写授权来源记录编号').max(500),
  proof_type: z.enum(AUTHORIZATION_PROOF_TYPES, {
    error: '请选择证明材料类型',
  }),
  proof_reference: z.string().trim().min(1, '请填写证明材料的安全存储位置或编号').max(1000),
  proof_sha256: z.string().trim().refine(
    value => value === '' || /^[a-f0-9]{64}$/i.test(value),
    '证明材料摘要必须是64位SHA-256十六进制值',
  ),
  controller_name: z.string().trim().min(1, '请填写个人信息处理者名称').max(200),
  controller_contact: z.string().trim().min(1, '请填写个人信息权利联系渠道').max(500),
  authorized_at: dateTimeString,
  processing_expires_at: dateTimeString,
  external_processors: z.array(
    z.string().trim().min(1).max(200),
  ).min(0, '请至少列明一个实际外部处理方').max(20), // rules_only 模式下无外部处理方，允许空数组（前端表单仍要求列明）
  automated_decision_preference: z.enum(AUTOMATED_DECISION_PREFERENCES, {
    error: '请选择候选人的自动化决策偏好',
  }),
  impact_assessment_reference: z.string().trim().max(500),
  impact_assessment_completed_at: optionalDateTimeString,
}).superRefine((value, context) => {
  const authorizedAt = Date.parse(value.authorized_at);
  const processingExpiresAt = Date.parse(value.processing_expires_at);
  const now = Date.now();

  if (authorizedAt > now + 5 * 60 * 1000) {
    context.addIssue({
      code: 'custom',
      path: ['authorized_at'],
      message: '授权时间不能晚于当前时间',
    });
  }
  if (processingExpiresAt <= authorizedAt) {
    context.addIssue({
      code: 'custom',
      path: ['processing_expires_at'],
      message: '处理期限必须晚于授权时间',
    });
  }

  if (value.automated_decision_preference === 'assistive') {
    if (!value.impact_assessment_reference) {
      context.addIssue({
        code: 'custom',
        path: ['impact_assessment_reference'],
        message: '启用自动化辅助匹配前必须关联个人信息保护影响评估',
      });
    }
    if (!value.impact_assessment_completed_at) {
      context.addIssue({
        code: 'custom',
        path: ['impact_assessment_completed_at'],
        message: '请填写影响评估完成时间',
      });
    } else if (Date.parse(value.impact_assessment_completed_at) > now) {
      context.addIssue({
        code: 'custom',
        path: ['impact_assessment_completed_at'],
        message: '影响评估必须在启用自动化辅助匹配前完成',
      });
    }
  }
});

export type AuthorizationSubmission = z.infer<
  typeof authorizationSubmissionSchema
>;

export interface AuthorizationEvidenceRecord {
  purpose: string;
  authorized_at: string;
  processing_expires_at: string;
  source_type: AuthorizationSubmission['source_type'];
  source_reference: string;
  proof_type: AuthorizationSubmission['proof_type'];
  proof_reference: string;
  proof_sha256: string | null;
  notice_version: string;
  notice_snapshot: Record<string, unknown>;
  notice_text_sha256: string;
  external_processors: string[];
  automated_decision_disclosed: true;
  automated_decision_preference:
    AuthorizationSubmission['automated_decision_preference'];
  impact_assessment_reference: string | null;
  impact_assessment_completed_at: string | null;
  collected_by_user_id: string;
  collection_context_sha256: string;
  evidence_sha256: string;
  evidence_status: 'verified';
  is_active: true;
}

export function buildAuthorizationEvidence(
  submission: AuthorizationSubmission,
  collectedByUserId: string,
  collectionContext: {
    userAgent: string | null;
    forwardedFor: string | null;
  },
): AuthorizationEvidenceRecord {
  const authorizedAt = new Date(submission.authorized_at).toISOString();
  const processingExpiresAt = new Date(
    submission.processing_expires_at,
  ).toISOString();
  const impactAssessmentCompletedAt =
    submission.impact_assessment_completed_at === ''
      ? null
      : new Date(submission.impact_assessment_completed_at).toISOString();

  const noticeSnapshot: Record<string, unknown> = {
    version: AUTHORIZATION_NOTICE_VERSION,
    controller: {
      name: submission.controller_name,
      rights_contact: submission.controller_contact,
    },
    processing: {
      purpose: AUTHORIZATION_PURPOSE,
      methods: [
        '候选人信息的加密存储、检索与招聘流程管理',
        '基于职位要求的规则评分及可选AI辅助说明',
        '由招聘人员人工复核后开展招聘沟通',
      ],
      data_categories: [
        '身份与联系方式',
        '教育与工作经历',
        '技能、求职意向与简历内容',
        '职位匹配评分、依据与招聘流程状态',
      ],
      authorized_at: authorizedAt,
      expires_at: processingExpiresAt,
      expiry_action: '期限届满后停止处理，并依法删除或匿名化',
    },
    external_processors: submission.external_processors.map(name => ({
      name,
      purpose: '仅在受托范围内提供数据存储、系统运行或智能匹配支持',
    })),
    automated_decision: {
      disclosed: true,
      role: '匹配结果仅作为招聘人员的辅助信息，不直接作出录用或拒绝决定',
      potential_impact: '可能影响候选人展示顺序、人工复核优先级和沟通安排',
      candidate_preference: submission.automated_decision_preference,
      rights: [
        '要求说明自动化匹配的主要因素、依据和可能影响',
        '拒绝仅通过自动化决策作出对个人权益有重大影响的决定',
        '要求人工复核、更正、删除或撤回同意',
      ],
    },
  };

  const noticeTextSha256 = sha256(stableSerialize(noticeSnapshot));
  const collectionContextSha256 = sha256(stableSerialize(collectionContext));
  const evidenceSha256 = sha256(stableSerialize({
    authorized_at: authorizedAt,
    collected_by_user_id: collectedByUserId,
    collection_context_sha256: collectionContextSha256,
    notice_text_sha256: noticeTextSha256,
    proof_reference: submission.proof_reference,
    proof_sha256: submission.proof_sha256 || null,
    proof_type: submission.proof_type,
    source_reference: submission.source_reference,
    source_type: submission.source_type,
  }));

  return {
    purpose: AUTHORIZATION_PURPOSE,
    authorized_at: authorizedAt,
    processing_expires_at: processingExpiresAt,
    source_type: submission.source_type,
    source_reference: submission.source_reference,
    proof_type: submission.proof_type,
    proof_reference: submission.proof_reference,
    proof_sha256: submission.proof_sha256 || null,
    notice_version: AUTHORIZATION_NOTICE_VERSION,
    notice_snapshot: noticeSnapshot,
    notice_text_sha256: noticeTextSha256,
    external_processors: [...submission.external_processors],
    automated_decision_disclosed: true,
    automated_decision_preference: submission.automated_decision_preference,
    impact_assessment_reference:
      submission.impact_assessment_reference || null,
    impact_assessment_completed_at: impactAssessmentCompletedAt,
    collected_by_user_id: collectedByUserId,
    collection_context_sha256: collectionContextSha256,
    evidence_sha256: evidenceSha256,
    evidence_status: 'verified',
    is_active: true,
  };
}

export function firstAuthorizationValidationError(
  error: z.ZodError,
): string {
  return error.issues[0]?.message ?? '授权证据不完整';
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableSerialize(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}
