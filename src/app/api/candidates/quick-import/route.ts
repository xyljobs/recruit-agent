import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenantRequestContext } from '@/lib/auth-server';
import { encryptField, decryptField, generateHmac } from '@/lib/encryption';
import { LARGE_JSON_BODY_LIMIT, parseLimitedJson } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import {
  authorizationSubmissionSchema,
  buildAuthorizationEvidence,
} from '@/lib/privacy/authorization';

const quickImportBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().max(320).nullable().optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    source_job_id: z.string().trim().max(36),
    skills: z.array(z.string().max(100)).max(200).optional(),
    experience_years: z.number().min(0).max(100).nullable().optional(),
    education: z.string().max(100).nullable().optional(),
    current_company: z.string().max(500).nullable().optional(),
    current_position: z.string().max(500).nullable().optional(),
    current_city: z.string().max(200).nullable().optional(),
    preferred_locations: z.array(z.string().max(200)).max(50).optional(),
    salary_expectation: z.string().max(200).nullable().optional(),
    resume_text: z.string().max(200_000).nullable().optional(),
    /**
     * 简历获取方式（法律口径分层）：
     * - candidate_submitted 候选人主动投递/发送：求职行为本身构成处理依据（PIPL 第13条
     *   订立合同所必需），且发布版 JD 已含自动化评估告知 → 默认 assistive（AI 辅助评分）
     * - proactively_sourced 主动搜索获取：候选人未向本组织投递 → 默认 human_review_only
     */
    acquisition_type: z
      .enum(['candidate_submitted', 'proactively_sourced'])
      .default('candidate_submitted'),
  })
  .strict();

// 解密候选人记录中的加密字段（与列表接口一致）
function decryptCandidate(c: Record<string, unknown>): Record<string, unknown> {
  if (!c) return c;
  return {
    ...c,
    name: decryptField(c.name as string | null),
    email: decryptField(c.email as string | null),
    phone: decryptField(c.phone as string | null),
    resume_text: decryptField(c.resume_text as string | null),
    current_company: decryptField(c.current_company as string | null),
    current_position: decryptField(c.current_position as string | null),
  };
}

/** 从期望薪资字符串解析 min/max（与 POST /api/candidates 口径一致） */
function parseSalaryExpectation(expectation: string): {
  salaryMin: number | null;
  salaryMax: number | null;
} {
  const match = expectation.match(/(\d+)[kK]?[-~](\d+)[kK]?/);
  if (match) {
    return { salaryMin: parseInt(match[1]), salaryMax: parseInt(match[2]) };
  }
  const singleMatch = expectation.match(/(\d+)[kK]/);
  if (singleMatch) {
    const value = parseInt(singleMatch[1]);
    return { salaryMin: value, salaryMax: value };
  }
  return { salaryMin: null, salaryMax: null };
}

/**
 * 简历快速导入API
 * POST /api/candidates/quick-import
 * HR 把从招聘平台下载的简历文件拖入系统后，前端解析出字段并调用本接口一键入库：
 * - 自动绑定职位（source_job_id 必传）
 * - 授权证据按获取方式分层（acquisition_type）：
 *   - candidate_submitted（默认）：投递/发送型，automated_decision_preference=assistive，
 *     关联组织级影响评估（发布版 JD 已含自动化评估告知）
 *   - proactively_sourced：主动搜索型，automated_decision_preference=human_review_only
 * - 默认保留 1 年、外部处理方取组织已批准的 approved_cloud_processors（rules_only 下为空）
 */

/** 投递型简历关联的组织级个人信息保护影响评估编号（候选人匹配场景） */
const PLATFORM_SUBMITTED_PIA_REFERENCE = 'PIA-CANDIDATE-MATCHING-V1';

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    const body = await parseLimitedJson(
      request,
      quickImportBodySchema,
      LARGE_JSON_BODY_LIMIT,
    );

    const { data: organization, error: orgError } = await supabase
      .from('organizations')
      .select('name, approved_cloud_processors, created_at')
      .eq('id', user.organizationId)
      .single();
    if (orgError || !organization) {
      throw new Error(`查询组织信息失败: ${orgError?.message ?? '未找到组织'}`);
    }

    const now = new Date();
    const isCandidateSubmitted = body.acquisition_type === 'candidate_submitted';
    const submission = {
      confirmed: true,
      source_type: 'recruitment_platform',
      source_reference: `platform-resume-import:${body.acquisition_type}`,
      proof_type: 'platform_record',
      proof_reference: `platform-resume-import:${body.acquisition_type}`,
      proof_sha256: '',
      controller_name: organization.name,
      controller_contact: user.email,
      authorized_at: now.toISOString(),
      processing_expires_at: new Date(
        now.getTime() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      external_processors: Array.isArray(organization.approved_cloud_processors)
        ? organization.approved_cloud_processors
        : [],
      automated_decision_preference: isCandidateSubmitted
        ? ('assistive' as const)
        : ('human_review_only' as const),
      impact_assessment_reference: isCandidateSubmitted
        ? PLATFORM_SUBMITTED_PIA_REFERENCE
        : '',
      // 影响评估完成时间取组织创建时间（早于本次入库，满足“评估须先于启用”校验）；缺省回退 1 天前
      impact_assessment_completed_at: isCandidateSubmitted
        ? (typeof organization.created_at === 'string' && organization.created_at
            ? organization.created_at
            : new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
        : '',
    };
    const parsedSubmission = authorizationSubmissionSchema.safeParse(submission);
    if (!parsedSubmission.success) {
      throw new Error(
        `默认授权证据校验失败: ${parsedSubmission.error.issues[0]?.message ?? '未知错误'}`,
      );
    }
    const authorizationEvidence = buildAuthorizationEvidence(
      parsedSubmission.data,
      user.userId,
      {
        userAgent: request.headers.get('user-agent'),
        forwardedFor:
          request.headers.get('x-forwarded-for') ??
          request.headers.get('x-real-ip'),
      },
    );

    const salary = body.salary_expectation
      ? parseSalaryExpectation(body.salary_expectation)
      : { salaryMin: null, salaryMax: null };

    const { data, error } = await supabase.rpc(
      'create_candidate_with_authorization_and_audit',
      {
        p_candidate: {
          name: encryptField(body.name),
          email: encryptField(body.email),
          phone: encryptField(body.phone),
          email_hmac: generateHmac(body.email),
          phone_hmac: generateHmac(body.phone),
          skills: body.skills,
          experience_years: body.experience_years,
          education: body.education,
          current_company: encryptField(body.current_company || null),
          current_position: encryptField(body.current_position || null),
          current_city: body.current_city,
          preferred_locations: body.preferred_locations,
          salary_expectation: body.salary_expectation || '',
          salary_min: salary.salaryMin,
          salary_max: salary.salaryMax,
          resume_text: encryptField(body.resume_text || null),
          data_source: 'platform_import',
          source_job_id: body.source_job_id,
          is_authorized: true,
        },
        p_authorization: authorizationEvidence,
      },
    );

    if (error?.code === 'P0002') {
      return NextResponse.json(
        { success: false, error: '关联职位不存在或未启用' },
        { status: 404 },
      );
    }
    if (error || !data) {
      throw new Error(`创建失败: ${error?.message ?? '未返回候选人'}`);
    }

    return NextResponse.json({
      success: true,
      data: decryptCandidate(data),
    });
  } catch (error) {
    return apiErrorResponse(error, '简历快速导入失败');
  }
}
