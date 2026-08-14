import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenantRequestContext } from '@/lib/auth-server';
import { encryptField, decryptField, generateHmac } from '@/lib/encryption';
import {
  candidateListQuerySchema,
  LARGE_JSON_BODY_LIMIT,
  parseLimitedJson,
} from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  authorizationSubmissionSchema,
  buildAuthorizationEvidence,
  firstAuthorizationValidationError,
} from '@/lib/privacy/authorization';

const candidateCreateBodySchema = z.object({
  authorization: z.unknown(),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(320).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  resume_url: z.string().trim().max(2_000).nullable().optional(),
  skills: z.array(z.string().max(100)).max(200).optional(),
  experience_years: z.number().min(0).max(100).nullable().optional(),
  verified_experience_years: z.number().min(0).max(100).nullable().optional(),
  experience_years_status: z.enum(['confirmed', 'partial', 'unknown']).nullable().optional(),
  experience_years_evidence: z.string().max(2_000).nullable().optional(),
  education: z.string().max(200).nullable().optional(),
  current_company: z.string().max(500).nullable().optional(),
  current_position: z.string().max(500).nullable().optional(),
  current_city: z.string().max(200).nullable().optional(),
  preferred_locations: z.array(z.string().max(200)).max(50).optional(),
  salary_expectation: z.string().max(200).nullable().optional(),
  salary_min: z.number().int().min(0).max(10_000_000).nullable().optional(),
  salary_max: z.number().int().min(0).max(10_000_000).nullable().optional(),
  availability: z.string().max(200).nullable().optional(),
  job_change_frequency: z.number().min(0).max(100).nullable().optional(),
  work_history: z.array(z.record(z.string(), z.unknown())).max(100).optional(),
  resume_text: z.string().max(200_000).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
  data_source: z.string().trim().max(50).optional(),
}).strict();

// 数据脱敏函数
function maskName(name: string | null): string {
  if (!name) return '未知';
  if (name.length <= 1) return name;
  if (name.length === 2) return name[0] + '*';
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
}

function maskPhone(phone: string | null): string {
  if (!phone) return '未填写';
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

function maskEmail(email: string | null): string {
  if (!email) return '未填写';
  const [name, domain] = email.split('@');
  if (!domain) return email;
  const maskedName = name.length > 2 
    ? name[0] + '*'.repeat(name.length - 2) + name[name.length - 1]
    : name[0] + '*';
  return `${maskedName}@${domain}`;
}

// 解密候选人记录中的加密字段
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

// GET - 获取候选人列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.candidateList);
    const queryParams = candidateListQuerySchema.safeParse({
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      masked: searchParams.get('masked') ?? undefined,
    });
    if (!queryParams.success) {
      return NextResponse.json(
        { success: false, error: queryParams.error.issues[0]?.message || '分页参数无效' },
        { status: 400 },
      );
    }
    const { page, pageSize, search, masked } = queryParams.data;
    
    let query = supabase
      .from('candidates')
      .select('*', { count: 'exact' })
      .eq('organization_id', user.organizationId)
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (search) {
      // 搜索时：加密字段（name/company/position）不支持数据库层 ilike
      // 使用 HMAC 精确匹配 email/phone，非加密字段用 ilike
      const emailHmac = generateHmac(search);
      const phoneHmac = generateHmac(search);
      query = query.or(
        `education.ilike.%${search}%,current_city.ilike.%${search}%,email_hmac.eq.${emailHmac},phone_hmac.eq.${phoneHmac}`
      );
    }

    const { data, error, count } = await query;  // 分页由外层 range 控制，加密字段搜索走 /api/search 内存过滤

    if (error) {
      throw new Error(`查询失败: ${error.message}`);
    }

    // 解密加密字段
    const decryptedData = data?.map(decryptCandidate) || [];

    // 如果需要脱敏处理
    const processedData = masked 
      ? decryptedData.map(c => ({
          ...c,
          name: maskName(c.name as string | null),
          phone: maskPhone(c.phone as string | null),
          email: maskEmail(c.email as string | null),
        }))
      : decryptedData;

    const candidateIds = processedData
      .map(candidate => Reflect.get(candidate, 'id'))
      .filter((candidateId): candidateId is string =>
        typeof candidateId === 'string',
      );
    const authorizationByCandidate = new Map<
      string,
      Record<string, unknown>
    >();
    if (candidateIds.length > 0) {
      const { data: authorizations, error: authorizationError } = await supabase
        .from('authorization_records')
        .select(
          'id, candidate_id, authorized_at, revoked_at, purpose, processing_expires_at, source_type, source_reference, proof_type, proof_reference, proof_sha256, notice_version, external_processors, automated_decision_preference, automated_decision_objected_at, impact_assessment_reference, impact_assessment_completed_at, evidence_sha256, evidence_status, is_active',
        )
        .eq('organization_id', user.organizationId)
        .in('candidate_id', candidateIds)
        .order('authorized_at', { ascending: false });
      if (authorizationError) {
        throw new Error(`查询授权证据失败: ${authorizationError.message}`);
      }
      for (const authorization of authorizations ?? []) {
        if (!authorizationByCandidate.has(authorization.candidate_id)) {
          authorizationByCandidate.set(
            authorization.candidate_id,
            authorization,
          );
        }
      }
    }
    const candidatesWithAuthorization = processedData.map(candidate => {
      const candidateId = Reflect.get(candidate, 'id');
      return {
        ...candidate,
        authorization: typeof candidateId === 'string'
          ? authorizationByCandidate.get(candidateId) ?? null
          : null,
      };
    });

    return NextResponse.json({
      success: true,
      data: candidatesWithAuthorization,
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
      }
    });

  } catch (error) {
    console.error('获取候选人列表失败:', error);
    return apiErrorResponse(error, '获取候选人列表失败');
  }
}

// POST - 创建候选人
export async function POST(request: NextRequest) {
  try {
    const body = await parseLimitedJson(
      request,
      candidateCreateBodySchema,
      LARGE_JSON_BODY_LIMIT,
    );
    const authorizationResult = authorizationSubmissionSchema.safeParse(
      body?.authorization,
    );
    if (!authorizationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: firstAuthorizationValidationError(authorizationResult.error),
        },
        { status: 400 },
      );
    }
    if (typeof body?.name !== 'string' || body.name.trim() === '') {
      return NextResponse.json(
        { success: false, error: '请填写候选人姓名' },
        { status: 400 },
      );
    }
    
    const { supabase, user } = await getTenantRequestContext(request);
    const authorizationEvidence = buildAuthorizationEvidence(
      authorizationResult.data,
      user.userId,
      {
        userAgent: request.headers.get('user-agent'),
        forwardedFor: request.headers.get('x-forwarded-for')
          ?? request.headers.get('x-real-ip'),
      },
    );

    // 解析薪资：优先使用前端传来的salary_min/max，否则从salary_expectation解析
    let salaryMin: number | null = body.salary_min ?? null;
    let salaryMax: number | null = body.salary_max ?? null;
    let salaryExpectation = body.salary_expectation || '';
    
    // 如果前端传了salary_min/max，自动生成salary_expectation字符串
    if (salaryMin !== null && salaryMax !== null) {
      if (!salaryExpectation) {
        salaryExpectation = `${salaryMin}-${salaryMax}K`;
      }
    } else if (salaryExpectation) {
      // 如果只有salary_expectation字符串，尝试解析出min/max
      const match = salaryExpectation.match(/(\d+)[kK]?[-~](\d+)[kK]?/);
      if (match) {
        salaryMin = parseInt(match[1]);
        salaryMax = parseInt(match[2]);
      } else {
        const singleMatch = salaryExpectation.match(/(\d+)[kK]/);
        if (singleMatch) {
          salaryMin = parseInt(singleMatch[1]);
          salaryMax = parseInt(singleMatch[1]);
        }
      }
    }

    // AES-256-GCM 加密敏感字段后存入数据库
    const encryptedName = encryptField(body.name);
    const encryptedEmail = encryptField(body.email);
    const encryptedPhone = encryptField(body.phone);
    const encryptedResumeText = encryptField(body.resume_text || null);
    const encryptedCurrentCompany = encryptField(body.current_company || null);
    const encryptedCurrentPosition = encryptField(body.current_position || null);

    // 生成 HMAC 签名用于密文检索
    const emailHmac = generateHmac(body.email);
    const phoneHmac = generateHmac(body.phone);
    
    const { data, error } = await supabase.rpc(
      'create_candidate_with_authorization_and_audit',
      {
        p_candidate: {
          name: encryptedName,
          email: encryptedEmail,
          phone: encryptedPhone,
          email_hmac: emailHmac,
          phone_hmac: phoneHmac,
          resume_url: body.resume_url,
          skills: body.skills,
          experience_years: body.experience_years,
          verified_experience_years: body.verified_experience_years,
          experience_years_status: body.experience_years_status,
          experience_years_evidence: body.experience_years_evidence,
          education: body.education,
          current_company: encryptedCurrentCompany,
          current_position: encryptedCurrentPosition,
          current_city: body.current_city,
          preferred_locations: body.preferred_locations,
          salary_expectation: salaryExpectation,
          salary_min: salaryMin,
          salary_max: salaryMax,
          availability: body.availability,
          job_change_frequency: body.job_change_frequency,
          work_history: body.work_history,
          resume_text: encryptedResumeText,
          notes: body.notes,
          data_source: body.data_source || 'manual',
          is_authorized: true,
        },
        p_authorization: authorizationEvidence,
      },
    );

    if (error || !data) {
      throw new Error(`创建失败: ${error?.message ?? '未返回候选人'}`);
    }

    // 返回解密后的数据给前端
    const decryptedData = decryptCandidate(data);

    return NextResponse.json({
      success: true,
      data: decryptedData
    });

  } catch (error) {
    console.error('创建候选人失败:', error);
    return NextResponse.json(
      { error: '创建候选人失败' },
      { status: 500 }
    );
  }
}
