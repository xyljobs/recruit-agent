import { NextRequest, NextResponse } from 'next/server';
import { AiExecutionPolicyError } from '@/lib/ai/execution-policy';
import { createTenantAiExecutionGateway } from '@/lib/ai/gateway';
import { getTenantRequestContext } from '@/lib/auth-server';
import {
  bossKeywordBodySchema,
  bossKeywordResultSchema,
  JD_JSON_BODY_LIMIT,
  parseLimitedJson,
} from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const KEYWORD_STRATEGY_PROMPT = `你是一个专业的招聘搜索策略师，擅长将JD拆解为Boss直聘搜索关键词。

请分析以下职位描述，生成2~5组搜索关键词，总计候选人20~40人。

## 核心原则
1. 城市必须作为关键词的第一个词（如"上海 Java高级开发"）。用户没指定城市就别加。
2. 每组关键词预计5~10人。
3. 关键词要有层次：核心词（JD标题直接转）+ 同义变体 + 技术栈细分。
4. 每组只放一个职位名或一个技术方向，不要把多个独立技术词用空格堆在同一组。比如不要输出"杭州 微服务架构 Java"，应拆成"杭州 Java后端开发"和"杭州 微服务架构师"。
5. 优先使用Boss直聘上常见、宽度适中的职位名称；具体技能用于拆成不同组，不要模拟布尔搜索。

## 输出格式（严格JSON）
{
  "keywords": [
    { "keyword": "上海 Java高级开发", "count": 8, "purpose": "核心匹配" },
    { "keyword": "上海 后端开发工程师", "count": 6, "purpose": "同义变体" }
  ],
  "total": 14,
  "city": "上海"
}

只输出JSON，不要多余文字。`;

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.bossKeywords);
    const { jdContent, jdText, city } = await parseLimitedJson(
      request,
      bossKeywordBodySchema,
      JD_JSON_BODY_LIMIT,
    );
    const content = jdContent || jdText as string;

    const aiGateway = await createTenantAiExecutionGateway(
      supabase,
      user.organizationId,
      request.headers,
    );
    aiGateway.requireModel();

    const prompt = KEYWORD_STRATEGY_PROMPT + (city ? `\n\n指定城市：${city}` : '') + `\n\nJD内容：\n${content}`;

    const messages = [
      { role: 'user' as const, content: prompt }
    ];

    let fullResponse = '';
    const stream = aiGateway.stream(messages, {
      model: aiGateway.policy.modelName ?? undefined,
    });

    for await (const chunk of stream) {
      if (chunk.content) {
        fullResponse += chunk.content.toString();
      }
    }

    // Extract JSON from response
    const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { success: false, error: '关键词生成失败，请重试' },
        { status: 500 }
      );
    }

    const result = bossKeywordResultSchema.safeParse(JSON.parse(jsonMatch[0]));
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: '关键词生成结果超出允许范围，请重试' },
        { status: 502 },
      );
    }
    const total = result.data.keywords.reduce((sum, keyword) => sum + keyword.count, 0);

    return NextResponse.json({
      success: true,
      data: {
        ...result.data,
        total,
      },
    });
  } catch (error) {
    console.error('关键词生成失败:', error);
    if (error instanceof AiExecutionPolicyError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: 503 },
      );
    }
    return apiErrorResponse(error, '关键词生成失败');
  }
}
