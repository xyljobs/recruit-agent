import { NextRequest, NextResponse } from 'next/server';
import { AiExecutionPolicyError } from '@/lib/ai/execution-policy';
import { createTenantAiExecutionGateway } from '@/lib/ai/gateway';
import { getTenantRequestContext } from '@/lib/auth-server';
import { JD_JSON_BODY_LIMIT, jdParseBodySchema, parseLimitedJson } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { parseExperienceBand } from '@/lib/matching/screening-rubric';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const JD_PARSE_PROMPT = `你是一个专业的HR招聘助手，擅长解析职位描述(JD)并提取关键信息。

请分析以下职位描述，提取并结构化以下信息：

## 基础信息
1. 职位名称 (title)
2. 所属部门 (department)
3. 工作地点 (location)
4. 薪资范围 (salary_range) - 同时提取最低和最高薪资数值
5. 经验要求 (experience_required)
6. 学历要求 (education_required)

## 技能要求（关键字段）
7. 必需技能 (skills_required) - 数组格式，JD明确要求的技能
8. 加分技能 (bonus_skills) - 数组格式，JD中提到"优先"、"加分"、"最好有"的技能
9. 搜索关键词 (search_keywords) - 数组格式，6-10 个用于在招聘平台搜索人才的精炼关键词
    要求：包含职位别名（如"Java后端"→"后端工程师"、"Java开发工程师"）、核心技术词与同义词；每个关键词 2-10 字；不得包含"熟悉/精通/3年以上/经验/优先"等描述性语句

## 岗位详情
10. 岗位职责 (responsibilities) - 数组格式
11. 福利待遇 (benefits) - 数组格式
12. 紧急程度 (urgency) - 枚举值: urgent(紧急)/high(较高)/normal(常规)

## 智能分析（关键字段）
13. 隐含需求 (implicit_requirements) - 数组格式，从JD中推断出的未明确说明的需求
    例如："有大型项目经验" → 需要3年以上经验、有架构能力
         "抗压能力强" → 可能加班多，需要强调成长空间
         "熟悉微服务" → 需要Spring Cloud + Docker + 服务治理经验
14. 完整度 (completeness) - 0-100分，JD信息的完整程度
15. 缺失字段 (missing_fields) - 数组格式，JD中缺失的重要字段名称
16. 经验年限区间 (experience_band) - 对象，从JD的年限要求中提取：
    { "min": 最低年限数值或null, "preferred_max": 优先上限数值或null, "hard_max": 硬上限数值或null, "source": "explicit"或"inferred" }
    提取规则：
    - "3-5年" → min=3, preferred_max=5, hard_max=null
    - "3年以上" → min=3, preferred_max=null, hard_max=null
    - "5年以内" / "不超过6年" / "最多6年" / "上限6年" → hard_max=该数值
    - source 判定：JD原文明确写出"以内/不超过/上限/最多"等上限语义 → "explicit"；否则（如"3-5年"）→ "inferred"
    - JD未提及年限要求 → null

请以JSON格式返回结果，格式如下：
{
  "title": "职位名称",
  "department": "部门",
  "location": "地点",
  "salary_range": "薪资范围",
  "salary_min": 最低薪资数值,
  "salary_max": 最高薪资数值,
  "experience_required": "经验要求",
  "education_required": "学历要求",
  "skills_required": ["必需技能1", "必需技能2"],
  "bonus_skills": ["加分技能1", "加分技能2"],
  "search_keywords": ["Java", "后端工程师", "Spring Boot", "MySQL", "Redis", "微服务"],
  "responsibilities": ["职责1", "职责2"],
  "benefits": ["福利1", "福利2"],
  "urgency": "normal",
  "implicit_requirements": ["隐含需求1", "隐含需求2"],
  "completeness": 85,
  "missing_fields": ["缺失字段1"],
  "experience_band": { "min": 3, "preferred_max": 5, "hard_max": null, "source": "inferred" }
}

注意：
- 如果JD中未提及某项信息，该字段返回null
- 技能要求要细化，区分必需技能和加分技能
- 隐含需求要基于行业经验合理推断，不要过度解读
- 完整度评估标准：基础信息完整50% + 技能要求完整20% + 职责清晰20% + 薪资福利10%

JD内容：
`;

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.jdParse);
    const { jdContent, jobId } = await parseLimitedJson(
      request,
      jdParseBodySchema,
      JD_JSON_BODY_LIMIT,
    );

    const aiGateway = await createTenantAiExecutionGateway(
      supabase,
      user.organizationId,
      request.headers,
    );
    aiGateway.requireModel();

    // 使用流式输出解析JD
    const prompt = JD_PARSE_PROMPT + jdContent;

    const messages = [
      { role: 'user' as const, content: prompt }
    ];

    let fullResponse = '';
    const stream = aiGateway.stream(messages, {
      model: aiGateway.policy.modelName ?? undefined,
      temperature: 0.3,
    });

    for await (const chunk of stream) {
      if (chunk.content) {
        fullResponse += chunk.content.toString();
      }
    }

    // 解析JSON响应
    let parsedResult;
    try {
      // 提取JSON部分（去除可能的markdown代码块）
      const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('无法从响应中提取JSON');
      }
    } catch {
      console.error('JD解析失败，原始响应:', fullResponse);
      return NextResponse.json(
        { error: 'JD解析失败，请检查JD格式' },
        { status: 500 }
      );
    }

    // 保存到数据库（传入 jobId 时更新已有职位，否则新建）
    // 年限区间口径（计划 §4.2/§4.4）：hard_max_enabled 由服务端按 JD 原文重算，
    // 不信任 LLM 输出的 source；仅当 JD 年限表述含上限语义（以内/不超过/上限/最多）才启用硬门槛。
    const screeningRubric = buildScreeningRubric(
      parsedResult.experience_band,
      parsedResult.experience_required,
      jdContent,
    );
    const parsedFields = {
      title: parsedResult.title || '未命名职位',
      department: parsedResult.department,
      location: parsedResult.location,
      salary_range: parsedResult.salary_range,
      salary_min: parsedResult.salary_min || null,
      salary_max: parsedResult.salary_max || null,
      experience_required: parsedResult.experience_required,
      education_required: parsedResult.education_required,
      skills_required: parsedResult.skills_required || [],
      bonus_skills: parsedResult.bonus_skills || [],
      responsibilities: parsedResult.responsibilities,
      benefits: parsedResult.benefits,
      urgency: parsedResult.urgency || 'normal',
      implicit_requirements: parsedResult.implicit_requirements || [],
      completeness: parsedResult.completeness || null,
      missing_fields: parsedResult.missing_fields || [],
      raw_jd: jdContent,
      screening_rubric: screeningRubric,
    };

    if (jobId) {
      const { data, error } = await supabase
        .from('job_requirements')
        .update({ ...parsedFields, updated_at: new Date().toISOString() })
        .eq('id', jobId)
        .eq('organization_id', user.organizationId)
        .select()
        .single();

      if (error) {
        console.error('更新JD失败:', error);
        return NextResponse.json(
          { error: '更新职位失败，该职位可能已不存在' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        data: {
          id: data.id,
          ...parsedResult,
          screening_rubric: screeningRubric,
          created_at: data.created_at,
        }
      });
    }

    const { data, error } = await supabase
      .from('job_requirements')
      .insert({
        organization_id: user.organizationId,
        owner_user_id: user.userId,
        ...parsedFields,
        status: 'active',
        activated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('保存JD失败:', error);
      return NextResponse.json(
        { error: '保存JD失败' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: data.id,
        ...parsedResult,
        screening_rubric: screeningRubric,
        created_at: data.created_at,
      }
    });

  } catch (error) {
    console.error('JD解析API错误:', error);
    if (error instanceof AiExecutionPolicyError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: 503 },
      );
    }
    return apiErrorResponse(error, '服务器内部错误');
  }
}

/** 服务端重算年限区间：以经验要求文本解析为准，失败时回退 LLM 结构；source/enabled 按 JD 原文判定。 */
function buildScreeningRubric(
  llmBand: unknown,
  experienceRequired: unknown,
  jdContent: string,
): Record<string, unknown> {
  const parsedBand = parseExperienceBand(
    typeof experienceRequired === 'string' ? experienceRequired : '',
  );
  const bandShape = parsedBand ?? extractLlmBand(llmBand);
  if (!bandShape) return {};

  const upperBoundSemantics = /以内|不超过|上限|最多/;
  // 只检查 JD 中年限表述的上下文片段，避免"试用期不超过3个月"等无关表述误判
  const yearSegments = jdContent.match(
    /[^\n。；;]{0,15}(?:\d+(?:\.\d+)?\s*[-~～到至]?\s*\d*(?:\.\d+)?\s*年)[^\n。；;]{0,10}/g,
  ) ?? [];
  const explicit = upperBoundSemantics.test(String(experienceRequired ?? ''))
    || yearSegments.some((segment) => upperBoundSemantics.test(segment));
  return {
    experience_band: {
      ...bandShape,
      source: explicit ? 'explicit' : 'inferred',
      hard_max_enabled: explicit,
    },
  };
}

function extractLlmBand(value: unknown): {
  min: number | null;
  preferred_max: number | null;
  hard_max: number | null;
} | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const toNumber = (item: unknown): number | null => (
    typeof item === 'number' && Number.isFinite(item) ? item : null
  );
  const min = toNumber(record.min);
  const preferredMax = toNumber(record.preferred_max);
  const hardMax = toNumber(record.hard_max);
  if (min === null && preferredMax === null && hardMax === null) return null;
  return { min, preferred_max: preferredMax, hard_max: hardMax };
}
