import { z } from 'zod';

export const MAX_CANDIDATE_PAGE_SIZE = 100;
export const MAX_CANDIDATE_PAGE = 10_000;
export const MAX_JD_LENGTH = 20_000;
export const MAX_RESUME_TEXT_LENGTH = 20_000;
export const MAX_BOSS_KEYWORD_GROUPS = 5;
export const MAX_BOSS_COUNT_PER_KEYWORD = 10;
export const MAX_BOSS_TOTAL_COUNT = 40;
export const MAX_BATCH_MATCH_CANDIDATES = 100;
export const MAX_BATCH_MATCH_RESULTS = 50;

export const SMALL_JSON_BODY_LIMIT = 16 * 1024;
export const JD_JSON_BODY_LIMIT = 96 * 1024;
export const LARGE_JSON_BODY_LIMIT = 1024 * 1024;

const idSchema = z.string().trim().uuid('ID 格式无效');
const jdContentSchema = z.string()
  .trim()
  .min(1, '请提供有效的JD内容')
  .max(MAX_JD_LENGTH, `JD内容不能超过 ${MAX_JD_LENGTH} 个字符`);

export const candidateListQuerySchema = z.object({
  page: z.coerce.number()
    .int('页码必须是整数')
    .min(1, '页码不能小于 1')
    .max(MAX_CANDIDATE_PAGE, `页码不能超过 ${MAX_CANDIDATE_PAGE}`)
    .default(1),
  pageSize: z.coerce.number()
    .int('每页数量必须是整数')
    .min(1, '每页数量不能小于 1')
    .max(MAX_CANDIDATE_PAGE_SIZE, `每页最多返回 ${MAX_CANDIDATE_PAGE_SIZE} 条`)
    .default(20),
  search: z.string().trim().max(100, '搜索词不能超过 100 个字符').default(''),
  masked: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
});

const bossKeywordSchema = z.object({
  keyword: z.string().trim().min(1, '搜索关键词不能为空').max(100, '单组搜索关键词不能超过 100 个字符'),
  count: z.number()
    .int('搜索人数必须是整数')
    .min(1, '每组搜索人数不能小于 1')
    .max(MAX_BOSS_COUNT_PER_KEYWORD, `每组搜索人数不能超过 ${MAX_BOSS_COUNT_PER_KEYWORD}`),
});

export const bossExecuteBodySchema = z.object({
  keywords: z.array(bossKeywordSchema)
    .min(1, '请提供搜索关键词')
    .max(MAX_BOSS_KEYWORD_GROUPS, `搜索关键词最多 ${MAX_BOSS_KEYWORD_GROUPS} 组`),
  jdContent: z.string().trim().max(MAX_JD_LENGTH, `JD内容不能超过 ${MAX_JD_LENGTH} 个字符`).default(''),
  city: z.string().trim().max(100, '城市不能超过 100 个字符').optional(),
}).superRefine((body, context) => {
  const total = body.keywords.reduce((sum, keyword) => sum + keyword.count, 0);
  if (total > MAX_BOSS_TOTAL_COUNT) {
    context.addIssue({
      code: 'custom',
      path: ['keywords'],
      message: `单次搜索总人数不能超过 ${MAX_BOSS_TOTAL_COUNT} 人`,
    });
  }

  const normalized = body.keywords.map(keyword => keyword.keyword.toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({
      code: 'custom',
      path: ['keywords'],
      message: '搜索关键词不能重复',
    });
  }
});

export const bossKeywordBodySchema = z.object({
  jdContent: jdContentSchema.optional(),
  jdText: jdContentSchema.optional(),
  city: z.string().trim().max(100, '城市不能超过 100 个字符').optional(),
}).refine(body => Boolean(body.jdContent || body.jdText), {
  message: '请提供有效的JD内容',
  path: ['jdContent'],
});

export const bossKeywordResultSchema = z.object({
  keywords: z.array(bossKeywordSchema.extend({
    purpose: z.string().trim().max(100, '关键词用途不能超过 100 个字符').default(''),
  }))
    .min(1, '关键词生成结果为空')
    .max(MAX_BOSS_KEYWORD_GROUPS, `关键词生成结果不能超过 ${MAX_BOSS_KEYWORD_GROUPS} 组`),
  total: z.number().int().min(1).max(MAX_BOSS_TOTAL_COUNT),
  city: z.string().trim().max(100).nullable().optional(),
}).superRefine((result, context) => {
  const actualTotal = result.keywords.reduce((sum, keyword) => sum + keyword.count, 0);
  if (actualTotal > MAX_BOSS_TOTAL_COUNT) {
    context.addIssue({
      code: 'custom',
      path: ['keywords'],
      message: `关键词总人数不能超过 ${MAX_BOSS_TOTAL_COUNT} 人`,
    });
  }
});

export const batchMatchBodySchema = z.object({
  job_id: idSchema,
  client_event_id: idSchema,
  candidate_ids: z.array(idSchema)
    .min(1, '候选人ID列表不能为空')
    .max(MAX_BATCH_MATCH_CANDIDATES, `单次最多匹配 ${MAX_BATCH_MATCH_CANDIDATES} 位候选人`)
    .refine(ids => new Set(ids).size === ids.length, '候选人ID不能重复')
    .optional(),
  top_n: z.number()
    .int('返回数量必须是整数')
    .min(1, '返回数量不能小于 1')
    .max(MAX_BATCH_MATCH_RESULTS, `最多返回 ${MAX_BATCH_MATCH_RESULTS} 条结果`)
    .default(10),
});

export const batchMatchStatusQuerySchema = z.object({
  taskId: idSchema,
});

export const jdParseBodySchema = z.object({
  jdContent: jdContentSchema,
  jobId: idSchema.optional(),
});

export const candidateSearchBodySchema = z.strictObject({
  jobId: idSchema.optional(),
  keywords: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  skills: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  location: z.string().trim().max(200).optional(),
  salaryRange: z.string().trim().max(200).optional(),
  experienceRange: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(MAX_CANDIDATE_PAGE_SIZE).default(20),
});

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function parseLimitedJson<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  maxBytes: number,
): Promise<z.output<TSchema>> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new ApiRequestError(`请求体不能超过 ${maxBytes} 字节`, 413);
    }
  }

  const rawBody = await readBodyWithLimit(request.body, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new ApiRequestError('请求体必须是有效的 JSON', 400);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ApiRequestError(result.error.issues[0]?.message || '请求参数无效', 400);
  }
  return result.data;
}

async function readBodyWithLimit(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  if (!body) {
    throw new ApiRequestError('请求体不能为空', 400);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new ApiRequestError(`请求体不能超过 ${maxBytes} 字节`, 413);
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(combined);
  } catch {
    throw new ApiRequestError('请求体必须使用 UTF-8 编码', 400);
  }
}
