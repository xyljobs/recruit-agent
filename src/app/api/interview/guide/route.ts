import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AiExecutionPolicyError } from '@/lib/ai/execution-policy';
import { createTenantAiExecutionGateway } from '@/lib/ai/gateway';
import { ApiRequestError, parseLimitedJson, SMALL_JSON_BODY_LIMIT } from '@/lib/api-limits';
import { apiErrorResponse } from '@/lib/api-response';
import { getTenantRequestContext } from '@/lib/auth-server';
import { decryptField } from '@/lib/encryption';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getProcessableAuthorizationContext } from '@/lib/privacy/authorization-access';
import { normalizeRecruitingApiError, rpcErrorToRequestError } from '@/lib/recruiting/api-contracts';
import { BOUNDARY_CODES, type BoundaryFlag } from '@/lib/matching/verdict';
import {
  type InterviewGuideContent,
  assertNoProhibitedTopic,
  buildRulesOnlyInterviewGuide,
  canPrepareInterviewGuide,
  parseModelInterviewGuide,
  type CommonBankQuestion,
} from '@/lib/recruiting/interview-guide';

const PROMPT_VERSION = 'interview-guide-v1';

const MODEL_PROMPT = `你是一位企业招聘人员的面试准备助手。请基于已由招聘人员接受或覆盖的短名单条目生成面试提纲的候选人专项题部分。

约束：
1. 只允许基于给定的匹配证据、缺口、边界标记与候选人简历内容生成专项题，不得编造证据中不存在的事实。
2. 公共必问题由系统从 HR 题库另行拼入，你不得生成公共题；common_questions 字段必须返回空数组。
3. 不得输出候选人评分、等级、排序结论、录用或拒绝建议。
4. 面试题不得涉及婚姻、生育、年龄、户籍、籍贯、健康、病史、宗教、政治面貌、性取向、家庭财产等禁止询问话题。
5. 只返回一个严格 JSON 对象，不要 Markdown，不要额外字段。

JSON 字段：
- focus_areas: Array<{ dimension, why, must_verify }>，最多6项；must_verify 必须是布尔值 true 或 false（true=面试中必须核实，false=仅作参考），不要写文字描述
- common_questions: 必须为空数组
- targeted_questions: 6-10项，每项 { question, dimension, origin, expected_signals[], probe_followups[], scoring_anchors[] }
  - origin 取值：evidence_gap（证据缺口）/ depth_check（证据冲突或部分支持，需深挖）/ boundary_risk（边界风险）/ resume_probe（针对简历具体项目追问）
  - expected_signals 最多3项，probe_followups 最多2项，scoring_anchors 最多3项
- red_flags_to_check: string[]，最多5项
- interview_loop: Array<{ round, focus, minutes, interviewer_role }>，最多3项
- prohibited_topics: string[]

输入：
{input}`;

const interviewGuideBodySchema = z.strictObject({
  shortlist_entry_id: z.string().trim().uuid('ID 格式无效'),
  client_event_id: z.string().trim().uuid('ID 格式无效'),
});

interface ShortlistEntryRow {
  id: string;
  shortlist_run_id: string;
  match_record_id: string | null;
  candidate_id: string;
  human_decision: string;
  evidence_snapshot: unknown;
  missing_information: unknown;
}

interface DecisionEventRow {
  decision: string;
}

interface MatchDetailsRow {
  match_details: unknown;
}

interface BankQuestionRow {
  id: string;
  question: string;
  dimension: string;
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getTenantRequestContext(request);
    await enforceRateLimit(supabase, { scope: 'interview:guide' });
    const body = await parseLimitedJson(request, interviewGuideBodySchema, SMALL_JSON_BODY_LIMIT);
    const entry = await resolveGuideEntry(supabase, user.organizationId, body.shortlist_entry_id);
    const authorizationContext = await getProcessableAuthorizationContext(
      supabase,
      user.organizationId,
      entry.candidate_id,
    );
    if (!authorizationContext.processable) {
      throw new ApiRequestError('候选人授权已失效，不能读取资料或生成面试提纲', 403);
    }

    const { data: run, error: runError } = await supabase
      .from('shortlist_runs')
      .select('id, job_id')
      .eq('id', entry.shortlist_run_id)
      .eq('organization_id', user.organizationId)
      .maybeSingle();
    if (runError) throw new Error('shortlist run read failed');
    if (!run) throw new ApiRequestError('短名单不存在', 404);

    const [matchResult, candidateResult, bankResult] = await Promise.all([
      entry.match_record_id
        ? supabase
          .from('match_records')
          .select('match_details')
          .eq('id', entry.match_record_id)
          .eq('organization_id', user.organizationId)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from('candidates')
        .select('id, name, current_company, current_position, skills, experience_years, resume_text')
        .eq('id', entry.candidate_id)
        .eq('organization_id', user.organizationId)
        .maybeSingle(),
      supabase
        .from('interview_question_bank')
        .select('id, question, dimension')
        .eq('organization_id', user.organizationId)
        .eq('is_active', true)
        .or(`scope.eq.organization,and(scope.eq.job,job_id.eq."${run.job_id}")`)
        .order('scope', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(20),
    ]);
    if (matchResult.error || candidateResult.error || bankResult.error) {
      throw new Error('interview guide source read failed');
    }
    if (!candidateResult.data) {
      throw new ApiRequestError('候选人不存在', 404);
    }

    const matchDetails = (matchResult.data as MatchDetailsRow | null)?.match_details ?? {};
    const candidate = candidateResult.data;
    const candidateName = decryptField(candidate.name) ?? '候选人';
    const currentCompany = decryptField(candidate.current_company);
    const currentPosition = decryptField(candidate.current_position);

    const evidence = Array.isArray(entry.evidence_snapshot) ? entry.evidence_snapshot : [];
    const modelEvidence = evidence.flatMap(item => {
      if (typeof item !== 'object' || item === null) return [];
      const finding = Reflect.get(item, 'finding');
      const supportLevel = Reflect.get(item, 'support_level');
      const dimension = Reflect.get(item, 'dimension');
      if (typeof finding !== 'string' || typeof supportLevel !== 'string') return [];
      return [{
        finding: finding.slice(0, 300),
        support_level: supportLevel,
        dimension: typeof dimension === 'string' ? dimension.slice(0, 100) : null,
      }];
    });
    const missingInformation = Array.isArray(entry.missing_information)
      ? entry.missing_information.filter((item): item is string => typeof item === 'string')
      : [];
    const rawGaps = typeof matchDetails === 'object' && matchDetails !== null
      ? Reflect.get(matchDetails, 'gaps')
      : null;
    const gaps = Array.isArray(rawGaps)
      ? rawGaps.filter((item): item is string => typeof item === 'string').map(item => item.slice(0, 300))
      : [];
    const rawConstraintAnalysis = typeof matchDetails === 'object' && matchDetails !== null
      ? Reflect.get(matchDetails, 'constraint_analysis')
      : null;
    const rawBoundaryFlags = typeof rawConstraintAnalysis === 'object' && rawConstraintAnalysis !== null
      ? Reflect.get(rawConstraintAnalysis, 'boundary_flags')
      : null;
    const boundaryFlags: BoundaryFlag[] = Array.isArray(rawBoundaryFlags)
      ? rawBoundaryFlags.flatMap(item => {
        if (typeof item !== 'object' || item === null) return [];
        const code = Reflect.get(item, 'code');
        const label = Reflect.get(item, 'label');
        if (typeof code !== 'string' || typeof label !== 'string') return [];
        if (!(BOUNDARY_CODES as readonly string[]).includes(code)) return [];
        return [{ code: code as BoundaryFlag['code'], label }];
      })
      : [];

    // 公共题：组织级优先，不足 4 条用职位级补充；原文直接拼回，不进入 LLM prompt
    const bankRows = (bankResult.data ?? []) as BankQuestionRow[];
    const commonQuestions: CommonBankQuestion[] = bankRows
      .slice(0, 4)
      .map(row => ({ id: row.id, question: row.question, dimension: row.dimension }));

    const sourceInput = {
      evidence: modelEvidence,
      gaps,
      missing_information: missingInformation,
      boundary_flags: boundaryFlags,
      resume_text: typeof candidate.resume_text === 'string' ? candidate.resume_text : null,
    };

    const aiGateway = await createTenantAiExecutionGateway(
      supabase,
      user.organizationId,
      request.headers,
      authorizationContext.externalProcessors,
    );
    const finalizeGuide = async (content: InterviewGuideContent) => {
      for (const item of content.targeted_questions) {
        assertNoProhibitedTopic(item.question);
        for (const followup of item.probe_followups) {
          assertNoProhibitedTopic(followup);
        }
      }

      const { data: storedGuide, error: guideError } = await supabase.rpc(
        'create_interview_guide',
        {
          p_shortlist_entry_id: entry.id,
          p_prompt_version: PROMPT_VERSION,
          p_ai_mode: aiGateway.mode,
          p_focus_areas: content.focus_areas,
          p_questions: {
            common_questions: content.common_questions,
            targeted_questions: content.targeted_questions,
          },
          p_red_flags: content.red_flags_to_check,
          p_interview_loop: content.interview_loop,
          p_common_question_ids: content.common_questions.map(item => item.bank_id),
        },
      );
      if (guideError) {
        throw rpcErrorToRequestError(guideError, '保存面试提纲失败');
      }

      return {
        guide: storedGuide,
        content,
        candidate_name: candidateName,
      };
    };

    // rules_only 模式：本地规则即时返回 JSON（无外部调用，无需流式）
    if (!aiGateway.canUseModel) {
      const content = buildRulesOnlyInterviewGuide(commonQuestions, sourceInput);
      const data = await finalizeGuide(content);
      return NextResponse.json({ success: true, data });
    }

    // AI 模式：NDJSON 流式，逐分片回传生成过程，done 携带最终面试提纲
    const prompt = MODEL_PROMPT.replace('{input}', JSON.stringify({
      accepted_shortlist_evidence: modelEvidence,
      gaps,
      missing_information: missingInformation,
      boundary_flags: boundaryFlags,
      candidate: {
        skills: candidate.skills,
        experience_years: candidate.experience_years,
        resume_text: typeof candidate.resume_text === 'string'
          ? candidate.resume_text.slice(0, 8000)
          : null,
      },
    }));

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enqueueLine = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        };
        enqueueLine({ type: 'start' });
        try {
          let rawOutput = '';
          const chunks = aiGateway.stream(
            [{ role: 'user', content: prompt }],
            {
              model: aiGateway.policy.modelName ?? undefined,
              temperature: 0.4,
              // 思考模型默认会先输出大量隐式推理（qwen3.7-plus），结构化 JSON 抽取无需思考，
              // 显式关闭以避免输出散漫文字破坏 JSON 解析（与 jd/parse、jd/keywords 等接口一致）
              enableThinking: false,
            },
            {
              directIdentifiers: [
                candidateName,
                currentCompany,
                currentPosition,
              ].filter((value): value is string => Boolean(value)),
            },
          );
          for await (const chunk of chunks) {
            rawOutput += chunk.content;
            if (rawOutput.length > 20_000) {
              throw new ApiRequestError('模型返回内容过长', 502);
            }
            enqueueLine({ type: 'delta', text: chunk.content });
          }
          let content: InterviewGuideContent;
          try {
            content = parseModelInterviewGuide(rawOutput);
          } catch (parseError) {
            const detail = parseError instanceof z.ZodError
              ? parseError.issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('；')
              : (parseError instanceof Error ? parseError.message : '未知解析错误');
            const snippet = rawOutput.replace(/\s+/g, ' ').trim().slice(0, 400);
            throw new ApiRequestError(`模型未返回有效的结构化面试提纲：${detail}｜原始输出片段：${snippet}`, 502);
          }
          // 公共题原文只从题库拼回，模型输出中的公共题一律丢弃（防改写）
          content = {
            ...content,
            common_questions: commonQuestions.map(item => ({
              bank_id: item.id,
              question: item.question,
              dimension: item.dimension,
            })),
          };
          // 兜底：模型专项题不足 6 条时用规则题补齐，保证与 rules_only 一致的体验
          if (content.targeted_questions.length < 6) {
            const fallback = buildRulesOnlyInterviewGuide(commonQuestions, sourceInput).targeted_questions;
            const existing = new Set(content.targeted_questions.map(item => item.question));
            const fillers = fallback.filter(item => !existing.has(item.question));
            content = {
              ...content,
              targeted_questions: [...content.targeted_questions, ...fillers].slice(0, 10),
            };
          }
          const data = await finalizeGuide(content);
          enqueueLine({ type: 'done', data });
          controller.close();
        } catch (streamError) {
          enqueueLine({
            type: 'error',
            error: streamError instanceof Error ? streamError.message : '生成面试提纲失败',
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
    return apiErrorResponse(
      normalizeRecruitingApiError(error, '生成面试提纲失败'),
      '生成面试提纲失败',
    );
  }
}

async function resolveGuideEntry(
  supabase: Awaited<ReturnType<typeof getTenantRequestContext>>['supabase'],
  organizationId: string,
  shortlistEntryId: string,
): Promise<ShortlistEntryRow> {
  const { data: entries, error } = await supabase
    .from('shortlist_entries')
    .select('id, shortlist_run_id, match_record_id, candidate_id, human_decision, evidence_snapshot, missing_information')
    .eq('organization_id', organizationId)
    .eq('id', shortlistEntryId)
    .limit(1);
  if (error) throw new Error('shortlist entry read failed');
  const entry = entries?.[0] as ShortlistEntryRow | undefined;
  if (!entry) {
    throw new ApiRequestError('没有可用于面试准备的短名单条目', 404);
  }

  const { data: decisionEvents, error: decisionError } = await supabase
    .from('recommendation_decision_events')
    .select('decision')
    .eq('organization_id', organizationId)
    .eq('shortlist_entry_id', entry.id)
    .order('occurred_at', { ascending: false })
    .order('recorded_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (decisionError) throw new Error('shortlist decision read failed');
  const latestDecision = decisionEvents?.[0] as DecisionEventRow | undefined;
  if (!canPrepareInterviewGuide(entry.human_decision, latestDecision?.decision)) {
    throw new ApiRequestError('请先由招聘人员接受或覆盖该短名单条目', 409);
  }
  return entry;
}
