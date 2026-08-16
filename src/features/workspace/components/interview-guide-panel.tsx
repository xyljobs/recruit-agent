'use client';

import { authFetch } from '@/lib/auth-client';

export interface InterviewGuideContent {
  focus_areas: Array<{ dimension: string; why: string; must_verify: boolean }>;
  common_questions: Array<{ bank_id?: string; question: string; dimension: string; answer?: string }>;
  targeted_questions: Array<{
    question: string;
    dimension: string;
    origin: 'evidence_gap' | 'depth_check' | 'boundary_risk' | 'resume_probe';
    expected_signals: string[];
    probe_followups: string[];
    scoring_anchors: string[];
    answer?: string;
  }>;
  red_flags_to_check: string[];
  interview_loop: Array<{ round: number; focus: string; minutes: number; interviewer_role: string }>;
  prohibited_topics: string[];
}

export interface PreparedInterviewGuide {
  guide: { id: string; ai_mode: string } | null;
  content: InterviewGuideContent;
  candidate_name: string;
}

export function guideToPlainText(guide: InterviewGuideContent, candidateName: string): string {
  const lines: string[] = [];
  lines.push(`面试提纲：${candidateName}`);
  lines.push('');
  lines.push('一、考察重点');
  guide.focus_areas.forEach((area, index) => {
    lines.push(`${index + 1}. ${area.dimension}${area.must_verify ? '（必须核实）' : ''}：${area.why}`);
  });
  lines.push('');
  lines.push('二、公共必问题（来自 HR 题库，未经 AI 改写）');
  guide.common_questions.forEach((item, index) => {
    lines.push(`${index + 1}. [${item.dimension}] ${item.question}`);
    if (item.answer) lines.push(`   回答：${item.answer}`);
  });
  lines.push('');
  lines.push('三、候选人专项题');
  guide.targeted_questions.forEach((item, index) => {
    lines.push(`${index + 1}. [${item.dimension}] ${item.question}`);
    if (item.expected_signals.length > 0) lines.push(`   期望信号：${item.expected_signals.join('；')}`);
    if (item.probe_followups.length > 0) lines.push(`   追问路径：${item.probe_followups.join('；')}`);
    if (item.scoring_anchors.length > 0) lines.push(`   打分锚点：${item.scoring_anchors.join('；')}`);
    if (item.answer) lines.push(`   回答：${item.answer}`);
  });
  lines.push('');
  lines.push('四、风险核查');
  guide.red_flags_to_check.forEach(item => lines.push(`- ${item}`));
  lines.push('');
  lines.push('五、面试轮次建议');
  guide.interview_loop.forEach(item => lines.push(`- 第 ${item.round} 轮（${item.minutes} 分钟，${item.interviewer_role}）：${item.focus}`));
  lines.push('');
  lines.push('六、禁问提示');
  lines.push(guide.prohibited_topics.join('、'));
  return lines.join('\n');
}

/** 调用面试提纲生成接口；失败时抛出携带 HTTP 状态码的 Error（409 = 未完成人工决策）；onDelta 用于流式回传生成过程 */
export async function generateInterviewGuide(
  entryId: string,
  onDelta?: (text: string) => void,
): Promise<PreparedInterviewGuide> {
  const response = await authFetch('/api/interview/guide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shortlist_entry_id: entryId, client_event_id: crypto.randomUUID() }),
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok) {
    const result: { error?: string } | null = await response.json().catch(() => null);
    const error = new Error(result?.error || '面试提纲生成失败');
    Object.assign(error, { status: response.status });
    throw error;
  }
  // JSON 响应：rules_only 模式本地规则即时返回
  if (contentType.includes('application/json')) {
    const result: { success?: boolean; data?: PreparedInterviewGuide; error?: string } = await response.json();
    if (!result.success || !result.data) {
      throw new Error(result.error || '面试提纲生成失败');
    }
    return result.data;
  }
  // NDJSON 流式：delta 为生成过程，done 携带最终结果
  const reader = response.body?.getReader();
  if (!reader) throw new Error('面试提纲生成失败');
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  const outcome: { data?: PreparedInterviewGuide; error?: string } = {};
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const event: { type?: string; text?: string; data?: PreparedInterviewGuide; error?: string } = JSON.parse(line);
    if (event.type === 'delta' && event.text) {
      accumulated += event.text;
      onDelta?.(accumulated);
    } else if (event.type === 'done' && event.data) {
      outcome.data = event.data;
    } else if (event.type === 'error') {
      outcome.error = event.error || '面试提纲生成失败';
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(handleLine);
  }
  handleLine(buffer);
  if (outcome.error) throw new Error(outcome.error);
  if (!outcome.data) throw new Error('面试提纲生成失败');
  return outcome.data;
}
