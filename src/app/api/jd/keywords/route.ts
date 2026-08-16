import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createTenantAiExecutionGateway } from '@/lib/ai/gateway';
import { getTenantRequestContext } from '@/lib/auth-server';
import { parseLimitedJson, SMALL_JSON_BODY_LIMIT } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { normalizeSearchKeywords } from '@/lib/matching/search-keywords';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const keywordsBodySchema = z.object({
  jobId: z.string().min(1),
  // 深度思考模式：思考型模型先深度推理 JD 语义再提炼，关键词更精准；代价是首字前有分钟级推理耗时
  deepThinking: z.boolean().optional(),
});

interface JobRow {
  title: string | null;
  raw_jd: string | null;
  skills_required: string[] | null;
  bonus_skills: string[] | null;
}

const KEYWORDS_PROMPT_HEAD = `你是一个专业的HR招聘助手，擅长从职位描述(JD)中提炼招聘平台搜索关键词。

请从以下职位描述中提炼 6-10 个可直接用于在招聘平台（如Boss直聘、智联招聘）搜索人才的关键词，按以下构成与口径输出：
① 职位词放最前：职位名称本身 + 1-2 个行业通用别名（如"Java后端"→"Java后端开发"、"后端工程师"）
② 硬技能词：JD 原文中明确出现的具体技术名词（语言/框架/工具/平台/协议，如 React、PLC、PROFINET）

准确性红线：
- 不得捏造 JD 未提及的技术词；不得放入"性能优化/架构设计/团队管理/沟通能力"等描述性能力短语（平台搜索噪音极大）
- 不得包含"熟悉/精通/N年以上/经验/优先"等修饰语；每个关键词 2-10 字

只输出 JSON 本身，不要输出任何解释、前言或代码块标记，格式如下：
{ "search_keywords": ["职位名", "行业别名", "技术词1", "技术词2"] }

职位名称：{TITLE}
JD内容：
`;

/** 快速模式流空闲超时：30 秒未产出新分片即中止，避免请求永久挂起 */
const KEYWORDS_IDLE_TIMEOUT_MS = 30_000;
/** 深度思考模式流空闲超时：思考型模型首字前推理实测可达 2 分钟，放宽到 3 分钟 */
const KEYWORDS_DEEP_IDLE_TIMEOUT_MS = 180_000;

/** 为异步分片流增加空闲超时：超时未产出新分片则抛出错误，避免请求永久挂起 */
async function* withIdleTimeout<T>(
  generator: AsyncGenerator<T>,
  idleTimeoutMs: number,
): AsyncGenerator<T> {
  const active: { timer?: ReturnType<typeof setTimeout> } = {};
  const nextWithTimeout = (): Promise<IteratorResult<T>> =>
    new Promise<IteratorResult<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('生成超时'));
        void generator.return(undefined).catch(() => undefined);
      }, idleTimeoutMs);
      active.timer = timer;
      generator.next().then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error('模型调用失败'));
        },
      );
    });
  try {
    while (true) {
      const result = await nextWithTimeout();
      if (result.done) return;
      yield result.value;
    }
  } finally {
    if (active.timer) clearTimeout(active.timer);
  }
}

/** raw_jd 缺失时用结构化字段拼出可提炼文本（保证规则回退与 AI 提炼都有输入） */
function buildJobText(job: JobRow): string {
  if (job.raw_jd?.trim()) return job.raw_jd.trim();
  const lines: string[] = [];
  if (job.title) lines.push(`职位名称：${job.title}`);
  if (job.skills_required?.length) lines.push(`必需技能：${job.skills_required.join('、')}`);
  if (job.bonus_skills?.length) lines.push(`加分技能：${job.bonus_skills.join('、')}`);
  return lines.join('\n');
}

/** 本地规则回退：从已解析技能中精炼关键词（rules_only 或模型失败时兜底） */
function buildFallbackKeywords(job: JobRow): string[] {
  return normalizeSearchKeywords(
    [...(job.skills_required ?? []), ...(job.bonus_skills ?? [])],
    job.title ?? '',
  );
}

/**
 * POST /api/jd/keywords
 * 单独重新生成岗位关键词：基于职位最新描述（raw_jd 优先）重新提炼 search_keywords 并持久化，
 * 不重跑整份 JD 解析。deepThinking=true 时开启思考模型深度推理（更精准，约需 1-3 分钟）。
 */
export async function POST(request: NextRequest) {
  try {
    const startedAt = Date.now();
    const { supabase, user } = await getTenantRequestContext(request);
    const { jobId, deepThinking } = await parseLimitedJson(
      request,
      keywordsBodySchema,
      SMALL_JSON_BODY_LIMIT,
    );
    const useDeepThinking = deepThinking === true;

    // 限流、职位查询、租户 AI 网关三者相互独立，并行执行以减少首字前的串行 DB 往返
    const [, jobQuery, aiGateway] = await Promise.all([
      enforceRateLimit(supabase, RATE_LIMITS.jdKeywords),
      supabase
        .from('job_requirements')
        .select('title, raw_jd, skills_required, bonus_skills')
        .eq('id', jobId)
        .eq('organization_id', user.organizationId)
        .single(),
      createTenantAiExecutionGateway(supabase, user.organizationId, request.headers),
    ]);
    const { data: job, error } = jobQuery;
    if (error || !job) {
      return NextResponse.json(
        { success: false, error: '职位不存在' },
        { status: 404 },
      );
    }
    const jobRow = job as JobRow;
    const jobTitle = jobRow.title ?? '未命名职位';
    const jobText = buildJobText(jobRow);
    console.info(`[jd/keywords] 前置准备耗时 ${Date.now() - startedAt}ms（deepThinking=${useDeepThinking}，canUseModel=${aiGateway.canUseModel}）`);

    const persistKeywords = async (keywords: string[]): Promise<void> => {
      const { error: updateError } = await supabase
        .from('job_requirements')
        .update({ search_keywords: keywords, updated_at: new Date().toISOString() })
        .eq('id', jobId)
        .eq('organization_id', user.organizationId);
      if (updateError) {
        console.error('保存岗位关键词失败:', updateError);
        throw new Error('关键词已生成，但保存失败，请重试');
      }
    };

    if (aiGateway.canUseModel && jobText) {
      const encoder = new TextEncoder();
      const prompt = KEYWORDS_PROMPT_HEAD.replace('{TITLE}', jobTitle) + jobText;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const enqueueLine = (payload: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
          };
          // 立即下发 start 事件，让前端第一时间收到响应体，确认链路未被缓冲
          enqueueLine({ type: 'start' });
          let fullResponse = '';
          let firstChunkAt: number | null = null;
          try {
            const chunks = withIdleTimeout(
              aiGateway.stream([{ role: 'user' as const, content: prompt }], {
                model: aiGateway.policy.modelName ?? undefined,
                temperature: 0.3,
                // 深度思考：显式开启思考模型隐式推理；快速模式：关闭思考避免分钟级首 token 延迟
                enableThinking: useDeepThinking,
              }),
              useDeepThinking ? KEYWORDS_DEEP_IDLE_TIMEOUT_MS : KEYWORDS_IDLE_TIMEOUT_MS,
            );
            for await (const chunk of chunks) {
              if (!chunk.content) continue;
              const text = chunk.content.toString();
              if (firstChunkAt === null) {
                firstChunkAt = Date.now();
                console.info(`[jd/keywords] 首字耗时 ${firstChunkAt - startedAt}ms`);
              }
              fullResponse += text;
              enqueueLine({ type: 'delta', text });
            }

            const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('无法从响应中提取JSON');
            const parsedResult = JSON.parse(jsonMatch[0]);
            const keywords = normalizeSearchKeywords(
              Array.isArray(parsedResult.search_keywords) ? parsedResult.search_keywords : [],
              jobTitle,
            );
            await persistKeywords(keywords);
            console.info(`[jd/keywords] 生成完成，总耗时 ${Date.now() - startedAt}ms，${keywords.length} 个关键词`);
            enqueueLine({ type: 'done', data: { search_keywords: keywords, generatedBy: 'ai' } });
            controller.close();
          } catch (streamError) {
            console.warn('AI重新生成关键词失败，回退本地规则精炼:', streamError);
            const keywords = buildFallbackKeywords(jobRow);
            try {
              await persistKeywords(keywords);
              enqueueLine({ type: 'done', data: { search_keywords: keywords, generatedBy: 'rules' } });
            } catch (persistError) {
              enqueueLine({
                type: 'error',
                error: persistError instanceof Error ? persistError.message : '关键词生成失败',
              });
            }
            controller.close();
          }
        },
      });
      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
        },
      });
    }

    // rules_only 或职位无文本内容：本地规则精炼即时返回
    const keywords = buildFallbackKeywords(jobRow);
    await persistKeywords(keywords);
    return NextResponse.json({
      success: true,
      data: { search_keywords: keywords, generatedBy: 'rules' },
    });
  } catch (error) {
    return apiErrorResponse(error, '重新生成岗位关键词失败');
  }
}
