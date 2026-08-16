import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createTenantAiExecutionGateway } from '@/lib/ai/gateway';
import { getTenantRequestContext } from '@/lib/auth-server';
import { parseLimitedJson, SMALL_JSON_BODY_LIMIT } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const generateBodySchema = z.object({
  jobId: z.string().min(1),
  // 深度思考模式：思考型模型先深度推理用人标准再撰写，文案质量更高但首字前有分钟级推理耗时
  deepThinking: z.boolean().optional(),
});

interface JobRow {
  title: string | null;
  department: string | null;
  location: string | null;
  salary_range: string | null;
  experience_required: string | null;
  education_required: string | null;
  skills_required: string[] | null;
  bonus_skills: string[] | null;
  responsibilities: string[] | null;
  benefits: string[] | null;
}

/** 发布版 JD 固定告知行：候选人投递前可见的自动化决策告知（PIPL 第17条告知义务），须与 JD 同时发布 */
const AI_EVALUATION_DISCLOSURE_LINE =
  '【招聘流程说明】本职位招聘使用 AI 辅助评估简历，最终录用决定由招聘团队作出；如需人工评估请在投递时备注。';

const GENERATE_PROMPT_HEAD = `你是一个专业的招聘文案专家。请基于以下结构化职位要求，生成一份适合在招聘平台（如Boss直聘、智联招聘）发布的职位描述。

要求：
- 直接输出纯文本，使用【】分节，顺序为：【招聘岗位】【岗位职责】【任职要求】【福利待遇】；工作地点、薪资范围如有则附在招聘岗位末尾一行；
- 岗位职责与任职要求用编号列表，各 3-6 条，简洁专业；
- 可在不改变事实的前提下润色措辞、增强吸引力；不得虚构公司名称、薪资承诺等要求中不存在的事实；
- 结尾必须另起一行，原样输出以下自动化评估告知（一字不改）：
${AI_EVALUATION_DISCLOSURE_LINE}
- 不要输出描述正文以外的任何解释或点评。

结构化职位要求：
`;

function listText(items: string[] | null): string {
  return (items ?? []).join('、');
}

/** 快速模式流空闲超时：超过该时间未收到新分片即中止，回退本地模板 */
const GENERATE_STREAM_IDLE_TIMEOUT_MS = 30_000;
/** 深度思考模式流空闲超时：开思考实测首字前推理可达 2 分钟，保留 5 分钟余量避免成功请求被误杀 */
const GENERATE_DEEP_IDLE_TIMEOUT_MS = 300_000;

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

/** AI 未启用或生成失败时，用本地模板确定性地生成发布版描述（rules_only 兼容） */
function buildTemplateDescription(job: JobRow): string {
  const lines: string[] = [];
  lines.push(
    `【招聘岗位】${job.title || '未命名职位'}${job.location ? `（工作地点：${job.location}）` : ''}`,
  );
  if (job.salary_range) lines.push(`薪资范围：${job.salary_range}`);
  lines.push('');

  lines.push('【岗位职责】');
  if (job.responsibilities?.length) {
    job.responsibilities.forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
  } else {
    lines.push('1. 负责职位相关的核心业务工作，参与团队目标的持续达成与优化。');
  }
  lines.push('');

  lines.push('【任职要求】');
  let requirementIndex = 1;
  if (job.education_required) {
    lines.push(`${requirementIndex++}. ${job.education_required}`);
  }
  if (job.experience_required) {
    lines.push(`${requirementIndex++}. ${job.experience_required}`);
  }
  if (job.skills_required?.length) {
    lines.push(`${requirementIndex++}. 必备技能：${listText(job.skills_required)}`);
  }
  if (job.bonus_skills?.length) {
    lines.push(`${requirementIndex++}. 加分项：${listText(job.bonus_skills)}`);
  }
  if (requirementIndex === 1) {
    lines.push('1. 具备以上职位要求的相关背景，欢迎投递。');
  }
  lines.push('');

  lines.push(`【福利待遇】${job.benefits?.length ? listText(job.benefits) : '面议'}`);
  lines.push('');
  lines.push(AI_EVALUATION_DISCLOSURE_LINE);
  return lines.join('\n');
}

/**
 * POST /api/jd/generate
 * 反哺职位描述：基于解析出的用人标准生成可发布到招聘平台的职位描述。
 * AI 可用时走模型润色；rules_only 或模型失败时回退本地模板。
 */
export async function POST(request: NextRequest) {
  try {
    const startedAt = Date.now();
    const { supabase, user } = await getTenantRequestContext(request);
    const { jobId, deepThinking } = await parseLimitedJson(
      request,
      generateBodySchema,
      SMALL_JSON_BODY_LIMIT,
    );
    const useDeepThinking = deepThinking === true;

    // 限流、职位查询、租户 AI 网关三者相互独立，并行执行以减少首字前的串行 DB 往返
    const [, jobQuery, aiGateway] = await Promise.all([
      enforceRateLimit(supabase, RATE_LIMITS.jdGenerate),
      supabase
        .from('job_requirements')
        .select(
          'title, department, location, salary_range, experience_required, education_required, skills_required, bonus_skills, responsibilities, benefits',
        )
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
    console.info(`[jd/generate] 前置准备耗时 ${Date.now() - startedAt}ms（deepThinking=${useDeepThinking}，canUseModel=${aiGateway.canUseModel}）`);

    /** 发布版描述持久化：写入 publish_jd 供下次进入页面直接复用；失败仅影响缓存复用，不阻断本次生成结果 */
    const persistPublishJd = async (description: string) => {
      const { error: persistError } = await supabase
        .from('job_requirements')
        .update({ publish_jd: description, updated_at: new Date().toISOString() })
        .eq('id', jobId)
        .eq('organization_id', user.organizationId);
      if (persistError) {
        console.warn(`[jd/generate] 发布版描述持久化失败: ${persistError.message}`);
      }
    };

    let description = '';
    if (aiGateway.canUseModel) {
      const encoder = new TextEncoder();
      const prompt = GENERATE_PROMPT_HEAD + JSON.stringify(jobRow, null, 2);
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const enqueueLine = (payload: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
          };
          // 立即下发 start 事件，让前端第一时间收到响应体，确认链路未被缓冲
          enqueueLine({ type: 'start' });
          let firstChunkAt: number | null = null;
          try {
            const chunks = withIdleTimeout(
              aiGateway.stream([{ role: 'user', content: prompt }], {
                model: aiGateway.policy.modelName ?? undefined,
                temperature: 0.6,
                // 深度思考：显式开启思考模型隐式推理；快速模式：关闭思考避免分钟级首 token 延迟
                enableThinking: useDeepThinking,
              }),
              useDeepThinking ? GENERATE_DEEP_IDLE_TIMEOUT_MS : GENERATE_STREAM_IDLE_TIMEOUT_MS,
            );
            for await (const chunk of chunks) {
              if (!chunk.content) continue;
              const text = chunk.content.toString();
              if (firstChunkAt === null) {
                firstChunkAt = Date.now();
                console.info(`[jd/generate] 首字耗时 ${firstChunkAt - startedAt}ms`);
              }
              description += text;
              enqueueLine({ type: 'delta', text });
            }
            description = description.trim();
            if (description) {
              // 兜底：模型未按提示输出告知行时确定性补齐，保证发布版 JD 恒含自动化评估告知
              if (!description.includes('【招聘流程说明】')) {
                description = `${description}\n\n${AI_EVALUATION_DISCLOSURE_LINE}`;
                enqueueLine({ type: 'delta', text: `\n\n${AI_EVALUATION_DISCLOSURE_LINE}` });
              }
              console.info(`[jd/generate] 生成完成，总耗时 ${Date.now() - startedAt}ms，${description.length} 字`);
              // done 前完成持久化：前端收到 done 后 reloadJobs 能读到最新 publish_jd
              await persistPublishJd(description);
              enqueueLine({ type: 'done', generatedBy: 'ai' });
              controller.close();
              return;
            }
          } catch (llmError) {
            console.warn('AI生成发布描述失败或超时，回退本地模板:', llmError);
          }
          // AI 未产出内容：回退本地模板一次性下发
          const templateDescription = buildTemplateDescription(jobRow);
          await persistPublishJd(templateDescription);
          enqueueLine({ type: 'delta', text: templateDescription });
          enqueueLine({ type: 'done', generatedBy: 'template' });
          controller.close();
        },
      });
      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
        },
      });
    }

    // rules_only：本地模板即时返回，无需流式
    const templateDescription = buildTemplateDescription(jobRow);
    await persistPublishJd(templateDescription);
    return NextResponse.json({
      success: true,
      data: { description: templateDescription, generatedBy: 'template' },
    });
  } catch (error) {
    return apiErrorResponse(error, '生成发布版职位描述失败');
  }
}
