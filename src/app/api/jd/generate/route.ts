import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createTenantAiExecutionGateway } from '@/lib/ai/gateway';
import { getTenantRequestContext } from '@/lib/auth-server';
import { parseLimitedJson, SMALL_JSON_BODY_LIMIT } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const generateBodySchema = z.object({ jobId: z.string().min(1) });

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

const GENERATE_PROMPT_HEAD = `你是一个专业的招聘文案专家。请基于以下结构化职位要求，生成一份适合在招聘平台（如Boss直聘、智联招聘）发布的职位描述。

要求：
- 直接输出纯文本，使用【】分节，顺序为：【招聘岗位】【岗位职责】【任职要求】【福利待遇】；工作地点、薪资范围如有则附在招聘岗位末尾一行；
- 岗位职责与任职要求用编号列表，各 3-6 条，简洁专业；
- 可在不改变事实的前提下润色措辞、增强吸引力；不得虚构公司名称、薪资承诺等要求中不存在的事实；
- 不要输出描述正文以外的任何解释或点评。

结构化职位要求：
`;

function listText(items: string[] | null): string {
  return (items ?? []).join('、');
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
  return lines.join('\n');
}

/**
 * POST /api/jd/generate
 * 反哺职位描述：基于解析出的用人标准生成可发布到招聘平台的职位描述。
 * AI 可用时走模型润色；rules_only 或模型失败时回退本地模板。
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.jdGenerate);
    const { jobId } = await parseLimitedJson(
      request,
      generateBodySchema,
      SMALL_JSON_BODY_LIMIT,
    );

    const { data: job, error } = await supabase
      .from('job_requirements')
      .select(
        'title, department, location, salary_range, experience_required, education_required, skills_required, bonus_skills, responsibilities, benefits',
      )
      .eq('id', jobId)
      .eq('organization_id', user.organizationId)
      .single();
    if (error || !job) {
      return NextResponse.json(
        { success: false, error: '职位不存在' },
        { status: 404 },
      );
    }
    const jobRow = job as JobRow;

    const aiGateway = await createTenantAiExecutionGateway(
      supabase,
      user.organizationId,
      request.headers,
    );

    let description = '';
    if (aiGateway.canUseModel) {
      try {
        const prompt = GENERATE_PROMPT_HEAD + JSON.stringify(jobRow, null, 2);
        const stream = aiGateway.stream([{ role: 'user', content: prompt }], {
          model: aiGateway.policy.modelName ?? undefined,
          temperature: 0.6,
        });
        for await (const chunk of stream) {
          if (chunk.content) description += chunk.content.toString();
        }
        description = description.trim();
      } catch (llmError) {
        console.warn('AI生成发布描述失败，回退本地模板:', llmError);
        description = '';
      }
    }

    const generatedBy = description ? 'ai' : 'template';
    if (!description) description = buildTemplateDescription(jobRow);

    return NextResponse.json({
      success: true,
      data: { description, generatedBy },
    });
  } catch (error) {
    return apiErrorResponse(error, '生成发布版职位描述失败');
  }
}
