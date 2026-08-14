import { z } from 'zod';
import { extractJsonObject } from '@/lib/ai/json';
import { ApiRequestError } from '@/lib/api-limits';
import type { BoundaryFlag } from '@/lib/matching/verdict';

/**
 * 面试提纲内容 schema（strictObject）。
 * 公共题（common_questions）原文只能来自题库，AI 生成阶段不接触公共题原文，
 * 由 API 路由在输出阶段按 bank_id 从数据库拼回（口径 4）。
 */
const focusAreaSchema = z.strictObject({
  dimension: z.string().trim().min(1).max(100),
  why: z.string().trim().min(1).max(500),
  must_verify: z.boolean(),
});

const commonQuestionSchema = z.strictObject({
  bank_id: z.string().trim().min(1).max(64),
  question: z.string().trim().min(1).max(500),
  dimension: z.string().trim().min(1).max(100),
});

const targetedQuestionSchema = z.strictObject({
  question: z.string().trim().min(1).max(500),
  dimension: z.string().trim().min(1).max(100),
  origin: z.enum(['evidence_gap', 'depth_check', 'boundary_risk', 'resume_probe']),
  expected_signals: z.array(z.string().trim().min(1).max(200)).max(3),
  probe_followups: z.array(z.string().trim().min(1).max(200)).max(2),
  scoring_anchors: z.array(z.string().trim().min(1).max(200)).max(3),
});

const interviewLoopSchema = z.strictObject({
  round: z.number().int().min(1).max(5),
  focus: z.string().trim().min(1).max(300),
  minutes: z.number().int().min(5).max(120),
  interviewer_role: z.string().trim().min(1).max(100),
});

export const interviewGuideContentSchema = z.strictObject({
  focus_areas: z.array(focusAreaSchema).max(6),
  common_questions: z.array(commonQuestionSchema).max(4),
  targeted_questions: z.array(targetedQuestionSchema).min(6).max(10),
  red_flags_to_check: z.array(z.string().trim().min(1).max(500)).max(5),
  interview_loop: z.array(interviewLoopSchema).max(3),
  prohibited_topics: z.array(z.string().trim().min(1).max(100)).max(20),
});

export type InterviewGuideContent = z.infer<typeof interviewGuideContentSchema>;

/** 禁问话题：题库录入与 AI 产出都必须过这道校验 */
export const PROHIBITED_INTERVIEW_TOPICS = [
  '婚姻',
  '生育',
  '年龄',
  '户籍',
  '籍贯',
  '健康',
  '病史',
  '宗教',
  '政治面貌',
  '性取向',
  '家庭财产',
] as const;

const PROHIBITED_DISPLAY_TOPICS = [
  '婚姻与生育计划',
  '年龄',
  '户籍与籍贯',
  '健康与病史',
  '宗教与政治面貌',
  '性取向',
  '家庭财产',
] as const;

export function assertNoProhibitedTopic(text: string): void {
  const hit = PROHIBITED_INTERVIEW_TOPICS.find(topic => text.includes(topic));
  if (hit) {
    throw new ApiRequestError(`面试题包含禁止询问的内容：${hit}`, 400);
  }
}

export interface CommonBankQuestion {
  id: string;
  question: string;
  dimension: string;
}

interface EvidenceItem {
  finding?: unknown;
  dimension?: unknown;
  support_level?: unknown;
}

export interface InterviewGuideSourceInput {
  evidence: readonly EvidenceItem[];
  gaps: readonly string[];
  missing_information: readonly string[];
  boundary_flags: readonly BoundaryFlag[];
  /** AI 模式 resume_probe 的来源；rules_only 不产出该 origin */
  resume_text?: string | null;
}

const BOUNDARY_QUESTION_TEMPLATES: Record<string, string> = {
  experience_boundary: '你目前的年限与岗位定位存在差异，请说明你对该岗位职责范围与发展预期的理解',
  frequent_job_change: '请说明近两次变动的原因与决策过程',
  cross_city: '请说明到岗时间与长期工作地安排',
};

const FALLBACK_DEPTH_QUESTION = '请介绍你与岗位要求最相关的一段工作经历，包括你负责的部分、关键技术决策与量化结果';

/**
 * 被人工接受或覆盖（accepted / overridden）且快照与最新决策事件一致时，
 * 允许准备面试提纲（口径 1：覆盖后可继续推进）。
 */
export function canPrepareInterviewGuide(
  snapshotDecision: string,
  latestEventDecision: string | null | undefined,
): boolean {
  if (snapshotDecision !== 'accepted' && snapshotDecision !== 'overridden') return false;
  return latestEventDecision === snapshotDecision;
}

function asString(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().slice(0, limit);
  return normalized || null;
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

/**
 * rules_only 个性化专项题实现主体：四来源（depth_check / evidence_gap /
 * boundary_risk / resume_probe），排序去重截断到 10 条，不足 6 条时用
 * focus_areas 补通用深度题，仍有缺口用兜底深度题补齐。
 */
export function buildRulesOnlyInterviewGuide(
  commonQuestions: readonly CommonBankQuestion[],
  input: InterviewGuideSourceInput,
): InterviewGuideContent {
  const targeted = [
    ...buildDepthCheckQuestions(input.evidence),
    ...buildEvidenceGapQuestions(input.gaps, input.missing_information),
    ...buildBoundaryRiskQuestions(input.boundary_flags),
  ];
  // resume_probe 仅 AI 模式产出（需要 LLM 针对具体项目追问），rules_only 不包含
  const deduped = dedupeStrings(targeted);
  const trimmed = deduped.slice(0, 10);

  const focusAreas = buildFocusAreas(input);
  const usedQuestions = new Set(trimmed);
  for (const area of focusAreas) {
    if (trimmed.length >= 10) break;
    const question = `围绕「${area.dimension}」，请具体说明你负责的部分、技术决策依据和最终量化结果`;
    if (usedQuestions.has(question)) continue;
    usedQuestions.add(question);
    trimmed.push(question);
  }
  while (trimmed.length < 6) {
    const question = `${FALLBACK_DEPTH_QUESTION}（${trimmed.length + 1}）`;
    if (usedQuestions.has(question)) continue;
    usedQuestions.add(question);
    trimmed.push(question);
  }

  const targetedQuestions = trimmed.map((question) => ({
    question,
    dimension: resolveQuestionDimension(question, focusAreas),
    origin: resolveQuestionOrigin(question, input),
    expected_signals: [],
    probe_followups: [],
    scoring_anchors: [],
  }));

  return interviewGuideContentSchema.parse({
    focus_areas: focusAreas,
    common_questions: commonQuestions.slice(0, 4).map(item => ({
      bank_id: item.id,
      question: item.question,
      dimension: item.dimension,
    })),
    targeted_questions: targetedQuestions,
    red_flags_to_check: buildRedFlags(focusAreas),
    interview_loop: [{
      round: 1,
      focus: '候选人经历核实与岗位匹配确认',
      minutes: 45,
      interviewer_role: 'HR 初面',
    }],
    prohibited_topics: [...PROHIBITED_DISPLAY_TOPICS],
  });
}

function buildDepthCheckQuestions(evidence: readonly EvidenceItem[]): string[] {
  const questions: string[] = [];
  for (const item of evidence) {
    if (item.support_level !== 'partial' && item.support_level !== 'conflicting') continue;
    const finding = asString(item.finding, 300);
    if (!finding) continue;
    questions.push(`围绕「${finding}」，请具体说明你负责的部分、技术决策依据和最终量化结果`);
  }
  return questions;
}

function buildEvidenceGapQuestions(gaps: readonly string[], missing: readonly string[]): string[] {
  const items = dedupeStrings([...gaps, ...missing].map(item => item.trim()).filter(Boolean));
  return items.map(gap => `请补充说明：${gap}；并举一个可核验的实例`);
}

function buildBoundaryRiskQuestions(flags: readonly BoundaryFlag[]): string[] {
  const questions: string[] = [];
  for (const flag of flags) {
    const template = BOUNDARY_QUESTION_TEMPLATES[flag.code];
    if (template) questions.push(template);
  }
  return questions;
}

function buildFocusAreas(input: InterviewGuideSourceInput): InterviewGuideContent['focus_areas'] {
  const areas: InterviewGuideContent['focus_areas'] = [];
  const seen = new Set<string>();
  const pushArea = (dimension: string, why: string, mustVerify: boolean) => {
    if (areas.length >= 6 || seen.has(dimension)) return;
    seen.add(dimension);
    areas.push({ dimension, why, must_verify: mustVerify });
  };
  for (const item of input.evidence) {
    if (item.support_level !== 'partial' && item.support_level !== 'conflicting') continue;
    const dimension = asString(item.dimension, 100) ?? '相关维度';
    pushArea(dimension, '匹配证据存在冲突或部分支持，需在面试中核实', true);
  }
  for (const item of input.evidence) {
    if (item.support_level !== 'supported') continue;
    const dimension = asString(item.dimension, 100) ?? '相关维度';
    pushArea(dimension, '已有证据支持，可作为考察重点', false);
  }
  for (const gap of [...input.gaps, ...input.missing_information]) {
    const text = gap.trim();
    if (!text) continue;
    pushArea(text.slice(0, 20), '候选人资料存在缺口，需在面试中补充', true);
  }
  return areas;
}

function buildRedFlags(focusAreas: InterviewGuideContent['focus_areas']): string[] {
  return focusAreas
    .filter(area => area.must_verify)
    .slice(0, 5)
    .map(area => `面试中重点核实：${area.dimension}（证据不足或冲突）`);
}

function resolveQuestionDimension(
  question: string,
  focusAreas: InterviewGuideContent['focus_areas'],
): string {
  for (const area of focusAreas) {
    if (question.includes(area.dimension)) return area.dimension;
  }
  return focusAreas[0]?.dimension ?? '综合能力';
}

function resolveQuestionOrigin(
  question: string,
  input: InterviewGuideSourceInput,
): 'evidence_gap' | 'depth_check' | 'boundary_risk' {
  if (question.startsWith('请补充说明：')) return 'evidence_gap';
  const boundaryTemplates = Object.values(BOUNDARY_QUESTION_TEMPLATES);
  if (boundaryTemplates.some(template => template === question)) return 'boundary_risk';
  return 'depth_check';
}

/** 模型输出 JSON 提取与校验（公共题字段会在 API 层被题库原文覆盖） */
export function parseModelInterviewGuide(value: string): InterviewGuideContent {
  return interviewGuideContentSchema.parse(
    JSON.parse(extractJsonObject(value)),
  );
}

/** 题库批量导入：逐行解析「题目 | 考察点 | 期望信号」，错误行不阻断其余行 */
export interface ParsedBankLine {
  line: number;
  question: string;
  dimension: string;
  expected_signals: string[];
  error: string | null;
}

export function parseBankBulkText(text: string): ParsedBankLine[] {
  const lines = text.split(/\r?\n/);
  const results: ParsedBankLine[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw) continue;
    const line = index + 1;
    const parts = raw.includes('|') ? raw.split('|') : raw.split('｜');
    const question = parts[0]?.trim() ?? '';
    const dimension = parts[1]?.trim() ?? '';
    const signals = (parts[2] ?? '')
      .split(/[,，、;；]/)
      .map(item => item.trim())
      .filter(Boolean);
    const base = { line, question, dimension, expected_signals: signals, error: null as string | null };
    if (!question || !dimension || parts.length < 2) {
      base.error = '字段不足：每行需「题目 | 考察点 | 期望信号」三列（期望信号可为空）';
    } else if (question.length > 500) {
      base.error = '题目超过 500 字上限';
    } else if (dimension.length > 50) {
      base.error = '考察点超过 50 字上限';
    } else if (signals.some(signal => signal.length > 200)) {
      base.error = '期望信号单项超过 200 字上限';
    } else if (seen.has(question)) {
      base.error = '题目与本批次已有行重复';
    } else {
      seen.add(question);
    }
    results.push(base);
  }
  return results;
}
