import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createTenantAiExecutionGateway } from '@/lib/ai/gateway';
import { MAX_RESUME_TEXT_LENGTH, parseLimitedJson } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { getTenantRequestContext } from '@/lib/auth-server';
import {
  extractResumeFieldsLocally,
  parseLlmJsonObject,
  sanitizeExtractedFields,
  type ExtractedResumeFields,
} from '@/lib/candidates/resume-extraction';
import { decryptField, generateHmac } from '@/lib/encryption';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const extractBodySchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, '请提供简历文本')
      .max(
        MAX_RESUME_TEXT_LENGTH,
        `简历文本不能超过 ${MAX_RESUME_TEXT_LENGTH} 个的字符`,
      ),
    // stream=true 时以 NDJSON 流式返回：先推 local（本地提取字段，秒级），
    // 再推 done（AI 合并字段 + 去重结果），用于前端渐进展示、缩短感知等待
    stream: z.boolean().optional(),
  })
  .strict();

// 请求体上限：简历文本上限 + JSON 包装开销
const EXTRACT_JSON_BODY_LIMIT = MAX_RESUME_TEXT_LENGTH + 16 * 1024;

const EXTRACT_PROMPT_HEAD = `你是一名专业的招聘简历信息提取助手。请从下方简历文本中提取候选人的结构化字段，并严格只输出一个 JSON 对象（不要输出 markdown 代码块或任何解释）。

JSON 结构（无法确定的字段填 "" 或 []，不要编造）：
{
  "name": "姓名",
  "phone": "手机号",
  "email": "邮箱",
  "current_city": "现居城市",
  "current_company": "当前或最近任职公司",
  "current_position": "当前或最近职位",
  "skills": ["技能"],
  "experience_years": 工作年限数字或 null,
  "education": "学历（博士/硕士/本科/大专，其他留空）",
  "salary_expectation": "期望薪资（如 20-30K）",
  "preferred_locations": ["意向城市"]
}

简历文本：
`;

const aiExtractedFieldsSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  current_city: z.string().optional(),
  current_company: z.string().optional(),
  current_position: z.string().optional(),
  skills: z.array(z.string()).optional(),
  experience_years: z.number().nullable().optional(),
  education: z.string().optional(),
  salary_expectation: z.string().optional(),
  preferred_locations: z.array(z.string()).optional(),
});

function toExtractedFields(value: z.output<typeof aiExtractedFieldsSchema>): ExtractedResumeFields {
  return {
    name: value.name ?? '',
    phone: value.phone ?? '',
    email: value.email ?? '',
    current_city: value.current_city ?? '',
    current_company: value.current_company ?? '',
    current_position: value.current_position ?? '',
    skills: value.skills ?? [],
    experience_years: value.experience_years ?? null,
    education: value.education ?? '',
    salary_expectation: value.salary_expectation ?? '',
    preferred_locations: value.preferred_locations ?? [],
  };
}

/**
 * 合并 AI 与本地提取结果：
 * - 联系方式（手机/邮箱）在 approved_cloud 模式下会被去标识化，模型无法还原，统一由本地正则兜底；
 * - 其余字段 AI 非空优先，本地补缺；技能与意向城市取并集。
 */
function mergeExtractedFields(
  ai: ExtractedResumeFields,
  local: ExtractedResumeFields,
): ExtractedResumeFields {
  const pickContact = (aiValue: string, localValue: string) =>
    aiValue && !aiValue.includes('去标识化') ? aiValue : localValue;
  return {
    name: pickContact(ai.name, local.name),
    phone: pickContact(ai.phone, local.phone),
    email: pickContact(ai.email, local.email),
    current_city: ai.current_city || local.current_city,
    current_company: ai.current_company || local.current_company,
    current_position: ai.current_position || local.current_position,
    skills: [...new Set([...ai.skills, ...local.skills])],
    experience_years: ai.experience_years ?? local.experience_years,
    education: ai.education || local.education,
    salary_expectation: ai.salary_expectation || local.salary_expectation,
    preferred_locations: [
      ...new Set([...ai.preferred_locations, ...local.preferred_locations]),
    ],
  };
}

// 脱敏姓名：张**三
function maskName(name: string | null): string {
  if (!name) return '未知';
  if (name.length <= 1) return name;
  if (name.length === 2) return name[0] + '*';
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
}

interface DuplicateCandidateHintPayload {
  id: string;
  name: string;
  created_at: string | null;
  created_by_name: string | null;
  source_job_title: string | null;
  source_job_binding_status: string | null;
  last_match: {
    overall_score: number | null;
    status: string | null;
    job_title: string | null;
  } | null;
}

type TenantSupabaseClient = Awaited<
  ReturnType<typeof getTenantRequestContext>
>['supabase'];
type TenantAiGateway = Awaited<
  ReturnType<typeof createTenantAiExecutionGateway>
>;

/**
 * 提取核心流程：本地启发式提取（即时）→ AI 网关深度解析 → 去重校验。
 * onLocal 在本地字段就绪时回调（流式模式用于先推送可确认的基础字段）。
 */
async function runFieldExtraction(params: {
  text: string;
  supabase: TenantSupabaseClient;
  organizationId: string;
  aiGateway: TenantAiGateway;
  localFields: ExtractedResumeFields;
  onLocal?: (fields: ExtractedResumeFields) => void;
}): Promise<{
  extracted: ExtractedResumeFields;
  duplicates: DuplicateCandidateHintPayload[];
  generatedBy: 'ai' | 'local';
}> {
  const { text, supabase, organizationId, aiGateway, localFields, onLocal } =
    params;
  let extracted = sanitizeExtractedFields(localFields);
  let generatedBy: 'ai' | 'local' = 'local';
  onLocal?.(extracted);

  if (aiGateway.canUseModel) {
    try {
      const prompt = EXTRACT_PROMPT_HEAD + text;
      let content = '';
      const stream = aiGateway.stream(
        [{ role: 'user', content: prompt }],
        {
          model: aiGateway.policy.modelName ?? undefined,
          temperature: 0.2,
        },
        {
          directIdentifiers: localFields.name ? [localFields.name] : [],
        },
      );
      for await (const chunk of stream) {
        if (chunk.content) content += chunk.content.toString();
      }
      const parsed = parseLlmJsonObject<unknown>(content.trim());
      if (parsed !== null && typeof parsed === 'object') {
        const aiResult = aiExtractedFieldsSchema.safeParse(parsed);
        if (aiResult.success) {
          const aiFields = toExtractedFields(aiResult.data);
          extracted = sanitizeExtractedFields(
            mergeExtractedFields(aiFields, extracted),
          );
          generatedBy = 'ai';
        }
      }
    } catch (llmError) {
      console.warn('AI提取简历字段失败，回退本地启发式:', llmError);
    }
  }

  // 去重：与候选人创建相同的 HMAC 检索（email/phone 精确匹配）
  // 命中时返回历史比对摘要：入库时间、录入人、绑定职位与最近一次匹配结论
  const emailHmac = generateHmac(extracted.email);
  const phoneHmac = generateHmac(extracted.phone);
  const duplicates: DuplicateCandidateHintPayload[] = [];
  if (emailHmac || phoneHmac) {
    let query = supabase
      .from('candidates')
      .select(
        'id, name, created_at, created_by, source_job_id, source_job_binding_status',
      )
      .eq('organization_id', organizationId);
    if (emailHmac && phoneHmac) {
      query = query.or(
        `email_hmac.eq.${emailHmac},phone_hmac.eq.${phoneHmac}`,
      );
    } else if (emailHmac) {
      query = query.eq('email_hmac', emailHmac);
    } else if (phoneHmac) {
      query = query.eq('phone_hmac', phoneHmac);
    }
    const { data, error } = await query.limit(5);
    if (error) {
      throw new Error(`重复校验失败: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{
      id: string;
      name: string | null;
      created_at: string | null;
      created_by: string | null;
      source_job_id: string | null;
      source_job_binding_status: string | null;
    }>;

    const creatorIds = [
      ...new Set(
        rows
          .map((row) => row.created_by)
          .filter((value): value is string => typeof value === 'string'),
      ),
    ];
    const candidateIds = rows.map((row) => row.id);

    const [creatorResult, matchResult] = await Promise.all([
      creatorIds.length > 0
        ? supabase.from('users').select('id, name').in('id', creatorIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from('match_records')
        .select('candidate_id, job_id, overall_score, status, created_at')
        .in('candidate_id', candidateIds)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    if (creatorResult.error) {
      throw new Error(`查询录入人失败: ${creatorResult.error.message}`);
    }
    if (matchResult.error) {
      throw new Error(`查询匹配记录失败: ${matchResult.error.message}`);
    }

    const jobIds = [
      ...new Set(
        [
          ...rows.map((row) => row.source_job_id),
          ...(matchResult.data ?? []).map(
            (match: { job_id: string | null }) => match.job_id,
          ),
        ].filter((value): value is string => typeof value === 'string'),
      ),
    ];
    const jobResult = jobIds.length > 0
      ? await supabase
          .from('job_requirements')
          .select('id, title')
          .in('id', jobIds)
      : { data: [], error: null };
    if (jobResult.error) {
      throw new Error(`查询职位失败: ${jobResult.error.message}`);
    }

    const nameByUserId = new Map<string, string>();
    for (const creator of creatorResult.data ?? []) {
      nameByUserId.set(creator.id, creator.name);
    }
    const titleByJobId = new Map<string, string>();
    for (const job of jobResult.data ?? []) {
      titleByJobId.set(job.id, job.title);
    }
    const latestMatchByCandidate = new Map<
      string,
      { overall_score: number | null; status: string | null; job_id: string | null }
    >();
    for (const match of matchResult.data ?? []) {
      if (!latestMatchByCandidate.has(match.candidate_id)) {
        latestMatchByCandidate.set(match.candidate_id, {
          overall_score: match.overall_score,
          status: match.status,
          job_id: match.job_id,
        });
      }
    }

    duplicates.push(
      ...rows.map((row) => {
        const lastMatch = latestMatchByCandidate.get(row.id);
        return {
          id: row.id,
          name: maskName(decryptField(row.name)),
          created_at: row.created_at,
          created_by_name: row.created_by
            ? (nameByUserId.get(row.created_by) ?? null)
            : null,
          source_job_title: row.source_job_id
            ? (titleByJobId.get(row.source_job_id) ?? null)
            : null,
          source_job_binding_status: row.source_job_binding_status,
          last_match: lastMatch
            ? {
                overall_score: lastMatch.overall_score,
                status: lastMatch.status,
                job_title: lastMatch.job_id
                  ? (titleByJobId.get(lastMatch.job_id) ?? null)
                  : null,
              }
            : null,
        };
      }),
    );
  }

  return { extracted, duplicates, generatedBy };
}

/**
 * POST /api/candidates/extract
 * 简历快捷入库：从粘贴的简历文本提取结构化字段并做去重提示。
 * AI 可用时经执行网关调用模型；rules_only 或模型失败时回退本地启发式提取。
 * body.stream=true 时按 NDJSON 流式返回：
 *   {"type":"local","fields":{...}}  —— 本地提取字段就绪（秒级，前端可先进入确认）
 *   {"type":"done","fields":{...},"duplicates":[...],"generatedBy":"ai"|"local"}
 *   {"type":"error","message":"..."} —— local 之后发生的失败（保留本地字段兜底）
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.candidateExtract);
    const { text, stream } = await parseLimitedJson(
      request,
      extractBodySchema,
      EXTRACT_JSON_BODY_LIMIT,
    );

    const localFields = extractResumeFieldsLocally(text);
    const aiGateway = await createTenantAiExecutionGateway(
      supabase,
      user.organizationId,
      request.headers,
    );

    if (stream) {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
          };
          try {
            const result = await runFieldExtraction({
              text,
              supabase,
              organizationId: user.organizationId,
              aiGateway,
              localFields,
              onLocal: (fields) => send({ type: 'local', fields }),
            });
            send({ type: 'done', ...result });
          } catch (error) {
            send({
              type: 'error',
              message:
                error instanceof Error ? error.message : '字段提取失败',
            });
          } finally {
            controller.close();
          }
        },
      });
      return new NextResponse(body, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    const result = await runFieldExtraction({
      text,
      supabase,
      organizationId: user.organizationId,
      aiGateway,
      localFields,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return apiErrorResponse(error, '简历字段提取失败');
  }
}
