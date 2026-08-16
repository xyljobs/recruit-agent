/** 岗位关键词精炼：将解析结果提炼为招聘平台可直接搜索人才的关键词 */

/** 描述性能力短语：在招聘平台搜索时噪音极大，统一从岗位关键词中过滤 */
const GENERIC_NOISE_TERMS = new Set([
  '性能优化',
  '架构设计',
  '系统设计',
  '团队管理',
  '项目管理',
  '沟通能力',
  '团队协作',
  '团队合作',
  '责任心',
  '抗压能力',
  '学习能力',
  '执行力',
  '自驱力',
]);

const KEYWORD_MAX_COUNT = 10;

/** 将原始技能/关键词提炼为招聘平台可用的简洁搜索词：拆分复合词、去除描述性修饰、过滤噪音词、去重 */
export function refineSearchKeywords(rawKeywords: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const refined: string[] = [];
  for (const raw of rawKeywords) {
    if (typeof raw !== 'string') continue;
    for (const part of raw.split(/[、，,;；/]+/)) {
      const original = part.trim();
      if (!original || GENERIC_NOISE_TERMS.has(original)) continue;
      const text = original
        .replace(/^(熟悉|精通|掌握|了解|熟练|具备|具有|有)/, '')
        .replace(/^\d+\s*年以上/, '')
        .replace(/(经验|能力|背景|者优先|优先|相关|基础)$/, '')
        .trim();
      if (text.length < 2 || text.length > 12) continue;
      if (GENERIC_NOISE_TERMS.has(text)) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      refined.push(text);
    }
  }
  return refined;
}

/** 职位名称是招聘平台最精准的搜索词，保证置于关键词首位 */
export function withTitleFirst(
  keywords: readonly string[],
  title: string | null | undefined,
): string[] {
  const trimmedTitle = (title ?? '').trim();
  if (!trimmedTitle) return [...keywords];
  const rest = keywords.filter((keyword) => keyword.trim() !== trimmedTitle);
  return [trimmedTitle, ...rest];
}

/** 服务端归一化 LLM 输出的 search_keywords：精炼去噪、职位名置首、上限 10 个 */
export function normalizeSearchKeywords(raw: unknown, title: string): string[] {
  const list = Array.isArray(raw) ? raw : [];
  return withTitleFirst(refineSearchKeywords(list), title).slice(0, KEYWORD_MAX_COUNT);
}
