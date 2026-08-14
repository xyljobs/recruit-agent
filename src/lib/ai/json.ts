/**
 * LLM 结构化 JSON 输出提取（共用工具）。
 * 从 fenced code block 或裸文本中截取第一个完整 JSON 对象。
 */
export function extractJsonObject(value: string): string {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? value).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型未返回结构化 JSON');
  return candidate.slice(start, end + 1);
}
