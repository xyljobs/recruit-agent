/**
 * 简历文本脱敏工具。
 *
 * 覆盖两类敏感信息：
 * 1. 自由文本 PII（手机号 / 邮箱 / 18 位证件号）——正则识别并部分遮蔽；
 * 2. 已知标识符（候选人姓名 / 当前公司）——由调用方从任务 manifest 提供，
 *    按长度降序替换，避免短标识符抢先吃掉长标识符的子串。
 *
 * 遮蔽策略为"部分保留"而非整体抹除：姓名仅保留姓氏，公司保留首尾字符，
 * 电话号码保留前 3 后 4，既满足查看需要又不暴露完整信息。
 */

const PHONE_PATTERN = /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const ID_CARD_PATTERN = /(?<!\d)\d{17}[\dXx](?!\d)/g;

export interface ResumeKnownIdentifiers {
  /** 候选人姓名，遮蔽后仅保留姓氏。 */
  names?: readonly (string | null | undefined)[];
  /** 候选人当前公司，遮蔽后保留首尾字符。 */
  companies?: readonly (string | null | undefined)[];
}

/** 仅保留首字符，其余以星号遮蔽（用于姓名）。 */
export function maskCandidateName(name: string | null | undefined): string {
  const value = name?.trim();
  if (!value) return '候选人';
  if (value.length <= 1) return '*';
  return `${value[0]}${'*'.repeat(value.length - 1)}`;
}

/** 保留首尾字符，中间以星号遮蔽（用于公司名）。 */
export function maskCompanyName(company: string | null | undefined): string {
  const value = company?.trim();
  if (!value) return '';
  if (value.length <= 2) return '**';
  return `${value[0]}${'*'.repeat(value.length - 2)}${value[value.length - 1]}`;
}

function maskPhone(match: string): string {
  const prefix = match.match(/^\+?86[- ]?/)?.[0] ?? '';
  const digits = match.slice(prefix.length);
  return `${prefix}${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

function maskEmail(match: string): string {
  const [local, domain] = match.split('@');
  if (!domain) return '***@***';
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskIdCard(match: string): string {
  return `${match.slice(0, 6)}********${match.slice(-4)}`;
}

function replaceKnownIdentifiers(
  text: string,
  values: readonly (string | null | undefined)[],
  mask: (value: string) => string,
): string {
  const identifiers = [...new Set(
    values
      .map(value => value?.trim())
      .filter((value): value is string => Boolean(value && value.length >= 2)),
  )].sort((left, right) => right.length - left.length);

  let result = text;
  for (const identifier of identifiers) {
    result = result.split(identifier).join(mask(identifier));
  }
  return result;
}

/**
 * 对简历文本做脱敏：
 * 1. 先替换已知标识符（姓名、公司），避免正则误伤；
 * 2. 再对剩余文本做电话 / 邮箱 / 证件号正则遮蔽。
 */
export function maskResumeText(
  text: string,
  identifiers: ResumeKnownIdentifiers = {},
): string {
  let result = replaceKnownIdentifiers(text, identifiers.names ?? [], maskCandidateName);
  result = replaceKnownIdentifiers(result, identifiers.companies ?? [], maskCompanyName);
  return result
    .replace(PHONE_PATTERN, maskPhone)
    .replace(EMAIL_PATTERN, maskEmail)
    .replace(ID_CARD_PATTERN, maskIdCard);
}
