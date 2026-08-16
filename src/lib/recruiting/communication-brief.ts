import { z } from 'zod';
import { extractJsonObject } from '@/lib/ai/json';

const briefItemSchema = z.string().trim().min(1).max(300);

export const communicationBriefContentSchema = z.strictObject({
  candidate_value_points: z.array(briefItemSchema).max(6),
  facts_to_verify: z.array(briefItemSchema).max(8),
  prohibited_claims: z.array(briefItemSchema).max(8),
  draft_message: z.string().trim().min(1).max(3000),
});

export type CommunicationBriefContent = z.infer<typeof communicationBriefContentSchema>;

interface EvidenceItem {
  finding?: unknown;
  support_level?: unknown;
}

export interface CommunicationBriefInput {
  candidate_name: string;
  current_position: string | null;
  job_title: string;
  salary_range: string | null;
  location: string | null;
  communication_goal: string;
  evidence: readonly EvidenceItem[];
  missing_information: readonly string[];
}

export const STANDARD_PROHIBITED_CLAIMS = [
  '不得承诺录用、Offer 或最终薪酬',
  '不得把匹配排序描述为自动化录用或拒绝决定',
  '不得把缺失或待核实的信息陈述为事实',
] as const;

export function canPrepareCommunicationBrief(
  snapshotDecision: string,
  latestEventDecision: string | null | undefined,
): boolean {
  return snapshotDecision === 'accepted' && latestEventDecision === 'accepted';
}

export function createRulesOnlyCommunicationBrief(
  input: CommunicationBriefInput,
): CommunicationBriefContent {
  const supportedFindings = uniqueBoundedStrings(input.evidence
    .filter(item => item.support_level === 'supported')
    .map(item => item.finding), 3);
  const uncertainFindings = uniqueBoundedStrings(input.evidence
    .filter(item => ['partial', 'conflicting', 'missing'].includes(String(item.support_level)))
    .map(item => item.finding), 4);
  const factsToVerify = uniqueBoundedStrings([
    ...input.missing_information,
    ...uncertainFindings,
  ], 6);
  const candidateValuePoints = supportedFindings.length > 0
    ? supportedFindings
    : ['候选人的具体经历与职位要求需要在沟通中进一步确认'];
  const firstValuePoint = candidateValuePoints[0];
  const locationText = input.location ? `，工作地点为${input.location}` : '';
  const salaryText = input.salary_range ? `，薪酬范围为${input.salary_range}` : '';

  return communicationBriefContentSchema.parse({
    candidate_value_points: candidateValuePoints,
    facts_to_verify: factsToVerify,
    prohibited_claims: [...STANDARD_PROHIBITED_CLAIMS],
    draft_message: `${input.candidate_name}您好，我们正在招聘${input.job_title}${locationText}${salaryText}。从现有资料看，${firstValuePoint}。目前这些信息仅用于招聘人员的初步判断，我们希望进一步了解您的真实经历与求职意向。${input.communication_goal}如您方便，期待安排一次简短沟通。`,
  });
}

/**
 * 模型输出的宽松 schema：用 z.object（默认 strip 未知字段）忽略 LLM 常见的
 * 多余字段，避免整体误报；严格 schema（communicationBriefContentSchema）仍用于
 * rules_only 构建。
 */
const modelCommunicationBriefSchema = z.object({ ...communicationBriefContentSchema.shape });

export function parseModelCommunicationBrief(value: string): CommunicationBriefContent {
  const parsed = modelCommunicationBriefSchema.parse(
    JSON.parse(extractJsonObject(value)),
  );
  return {
    ...parsed,
    prohibited_claims: uniqueBoundedStrings([
      ...STANDARD_PROHIBITED_CLAIMS,
      ...parsed.prohibited_claims,
    ], 8),
  };
}

function uniqueBoundedStrings(values: readonly unknown[], limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim().slice(0, 300);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length === limit) break;
  }
  return result;
}
