import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AiExecutionPolicyError } from '@/lib/ai/execution-policy';
import { createTenantAiExecutionGateway } from '@/lib/ai/gateway';
import { ApiRequestError, parseLimitedJson, SMALL_JSON_BODY_LIMIT } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { getTenantRequestContext } from '@/lib/auth-server';
import { decryptField, encryptField } from '@/lib/encryption';
import { getProcessableAuthorizationContext } from '@/lib/privacy/authorization-access';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  parseModelResumeStructure,
  RESUME_STRUCTURE_PROMPT,
  resumeStructureSchema,
  type ResumeStructure,
} from '@/lib/recruiting/resume-structure';
import { getSupabaseServiceClient } from '@/storage/database/supabase-client';

export const runtime = 'nodejs';

const RESUME_STRUCTURE_MAX_CHARS = 12_000;
const MAX_OUTPUT_CHARS = 8_000;

const bodySchema = z.strictObject({});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: candidateId } = await params;
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.candidateList);

    const { data: candidate, error } = await supabase
      .from('candidates')
      .select('resume_summary')
      .eq('id', candidateId)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (error) throw new Error('读取候选人失败');
    if (!candidate) throw new ApiRequestError('候选人不存在', 404);

    let structure: ResumeStructure | null = null;
    const cached = decryptField(candidate.resume_summary as string | null);
    if (cached) {
      try {
        structure = resumeStructureSchema.parse(JSON.parse(cached));
      } catch {
        structure = null;
      }
    }

    // 始终返回能否生成（前端据此决定是否展示「AI生成摘要」按钮，含重新生成场景）
    const authorizationContext = await getProcessableAuthorizationContext(
      supabase,
      user.organizationId,
      candidateId,
    );
    const aiGateway = await createTenantAiExecutionGateway(
      supabase,
      user.organizationId,
      request.headers,
      authorizationContext.externalProcessors,
    );
    const canGenerate = aiGateway.canUseModel && authorizationContext.processable;

    return NextResponse.json({
      success: true,
      data: { structure, canGenerate },
    });
  } catch (error) {
    if (error instanceof AiExecutionPolicyError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: 503 },
      );
    }
    return apiErrorResponse(error, '读取简历摘要失败');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: candidateId } = await params;
    await parseLimitedJson(request, bodySchema, SMALL_JSON_BODY_LIMIT);
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, RATE_LIMITS.candidateResumeSummary);

    const { data: candidate, error: candidateError } = await supabase
      .from('candidates')
      .select(
        'name, current_company, current_position, skills, experience_years, education, resume_text',
      )
      .eq('id', candidateId)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (candidateError) throw new Error('读取候选人失败');
    if (!candidate) throw new ApiRequestError('候选人不存在', 404);

    const resumeText = decryptField(candidate.resume_text as string | null);
    if (!resumeText || !resumeText.trim()) {
      throw new ApiRequestError('候选人没有简历摘要文本，无法生成', 400);
    }

    const authorizationContext = await getProcessableAuthorizationContext(
      supabase,
      user.organizationId,
      candidateId,
    );
    if (!authorizationContext.processable) {
      throw new ApiRequestError('候选人授权已失效，不能读取资料进行结构化', 403);
    }

    const aiGateway = await createTenantAiExecutionGateway(
      supabase,
      user.organizationId,
      request.headers,
      authorizationContext.externalProcessors,
    );
    if (!aiGateway.canUseModel) {
      return NextResponse.json(
        {
          success: false,
          error: '当前为规则模式，未启用 AI，无法生成结构化摘要',
          code: 'AI_EXECUTION_BLOCKED',
        },
        { status: 503 },
      );
    }

    const skills = Array.isArray(candidate.skills)
      ? candidate.skills.filter((skill): skill is string => typeof skill === 'string')
      : [];
    const prompt = RESUME_STRUCTURE_PROMPT.replace(
      '{input}',
      JSON.stringify({
        resume_text: resumeText.slice(0, RESUME_STRUCTURE_MAX_CHARS),
        registered_skills: skills,
        experience_years:
          typeof candidate.experience_years === 'number'
            ? candidate.experience_years
            : null,
        education: typeof candidate.education === 'string' ? candidate.education : null,
      }),
    );

    const candidateName = decryptField(candidate.name as string | null);
    const currentCompany = decryptField(candidate.current_company as string | null);
    const currentPosition = decryptField(candidate.current_position as string | null);

    const serviceSupabase = getSupabaseServiceClient();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enqueueLine = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        };
        enqueueLine({ type: 'start', message: '已读取简历原文，正在准备分析…' });
        try {
          let rawOutput = '';
          const chunks = aiGateway.stream(
            [{ role: 'user', content: prompt }],
            {
              model: aiGateway.policy.modelName ?? undefined,
              temperature: 0.3,
              enableThinking: false,
            },
            {
              directIdentifiers: [candidateName, currentCompany, currentPosition].filter(
                (value): value is string => Boolean(value),
              ),
            },
          );
          enqueueLine({
            type: 'progress',
            message: `简历原文共 ${resumeText.length} 字，正在调用模型提炼结构化摘要…`,
          });
          for await (const chunk of chunks) {
            rawOutput += chunk.content;
            if (rawOutput.length > MAX_OUTPUT_CHARS) {
              throw new ApiRequestError('模型返回内容过长', 502);
            }
          }

          enqueueLine({ type: 'progress', message: '模型分析完成，正在解析结构化结果…' });
          let structure: ResumeStructure;
          try {
            structure = parseModelResumeStructure(rawOutput);
          } catch {
            throw new ApiRequestError('模型未返回有效的简历结构化结果', 502);
          }

          enqueueLine({ type: 'progress', message: '正在保存摘要…' });
          const { error: updateError } = await serviceSupabase
            .from('candidates')
            .update({ resume_summary: encryptField(JSON.stringify(structure)) })
            .eq('id', candidateId)
            .eq('organization_id', user.organizationId);
          if (updateError) throw new Error('保存简历摘要失败');

          enqueueLine({ type: 'done', data: structure });
          controller.close();
        } catch (streamError) {
          enqueueLine({
            type: 'error',
            error: streamError instanceof Error ? streamError.message : '生成结构化摘要失败',
          });
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
  } catch (error) {
    if (error instanceof AiExecutionPolicyError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: 503 },
      );
    }
    return apiErrorResponse(error, '生成简历结构化摘要失败');
  }
}
