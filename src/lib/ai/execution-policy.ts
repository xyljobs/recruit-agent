import type { ChatMessage, ContentPart } from './llm';

export const AI_EXECUTION_MODES = [
  'rules_only',
  'private_endpoint',
  'approved_cloud',
] as const;

export type AiExecutionMode = (typeof AI_EXECUTION_MODES)[number];
export type AiService = 'model' | 'knowledge';

type AiEnvironment = Readonly<Record<string, string | undefined>>;

export class AiExecutionPolicyError extends Error {
  readonly code: 'AI_EXECUTION_BLOCKED' | 'AI_EXECUTION_CONFIG_INVALID';

  constructor(
    code: AiExecutionPolicyError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'AiExecutionPolicyError';
    this.code = code;
  }
}

export function resolveAiExecutionMode(value: unknown): AiExecutionMode {
  return typeof value === 'string'
    && (AI_EXECUTION_MODES as readonly string[]).includes(value.trim())
    ? value.trim() as AiExecutionMode
    : 'rules_only';
}

export class AiExecutionPolicy {
  readonly mode: AiExecutionMode;
  private readonly environment: AiEnvironment;

  constructor(mode: unknown, environment: AiEnvironment = process.env) {
    this.mode = resolveAiExecutionMode(mode);
    this.environment = environment;
  }

  static fromEnvironment(environment: AiEnvironment = process.env): AiExecutionPolicy {
    return new AiExecutionPolicy(
      environment.AI_EXECUTION_MODE ?? environment.AI_MODE,
      environment,
    );
  }

  get allowsExternalAi(): boolean {
    return this.mode !== 'rules_only';
  }

  get modelName(): string | null {
    return this.allowsExternalAi
      ? this.environment.LLM_MODEL?.trim() || 'qwen-plus'
      : null;
  }

  assertExternalCallAllowed(service: AiService): void {
    if (!this.allowsExternalAi) {
      throw new AiExecutionPolicyError(
        'AI_EXECUTION_BLOCKED',
        `${service === 'model' ? '模型' : '知识服务'}调用已被 rules_only 策略阻断`,
      );
    }
  }

  getModelBaseUrl(): string {
    this.assertExternalCallAllowed('model');

    const configuredUrl = this.mode === 'private_endpoint'
      ? this.environment.PRIVATE_LLM_BASE_URL ?? this.environment.LLM_BASE_URL
      : this.environment.APPROVED_CLOUD_LLM_BASE_URL ?? this.environment.LLM_BASE_URL;
    const baseUrl = configuredUrl?.trim();
    if (!baseUrl) {
      throw new AiExecutionPolicyError(
        'AI_EXECUTION_CONFIG_INVALID',
        `${this.mode} 模式未配置模型端点`,
      );
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(baseUrl);
    } catch {
      throw new AiExecutionPolicyError(
        'AI_EXECUTION_CONFIG_INVALID',
        `${this.mode} 模式的模型端点不是有效 URL`,
      );
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new AiExecutionPolicyError(
        'AI_EXECUTION_CONFIG_INVALID',
        '模型端点仅允许使用 HTTP 或 HTTPS',
      );
    }
    if (this.mode === 'approved_cloud' && parsedUrl.protocol !== 'https:') {
      throw new AiExecutionPolicyError(
        'AI_EXECUTION_CONFIG_INVALID',
        'approved_cloud 模型端点必须使用 HTTPS',
      );
    }

    if (
      this.mode === 'private_endpoint'
      && this.environment.AI_PRIVATE_ENDPOINT_CONFIRMED !== 'true'
      && !isPrivateHostname(parsedUrl.hostname)
    ) {
      throw new AiExecutionPolicyError(
        'AI_EXECUTION_CONFIG_INVALID',
        'private_endpoint 必须使用私有地址，或由管理员显式确认端点为私有边界',
      );
    }

    return baseUrl;
  }

  prepareMessages(
    messages: ChatMessage[],
    directIdentifiers: readonly string[] = [],
  ): ChatMessage[] {
    if (this.mode !== 'approved_cloud') {
      return messages;
    }

    return messages.map(message => ({
      ...message,
      content: typeof message.content === 'string'
        ? deidentifyText(message.content, directIdentifiers)
        : message.content.map(part => deidentifyContentPart(part, directIdentifiers)),
    }));
  }

  prepareKnowledgeQuery(
    query: string,
    directIdentifiers: readonly string[] = [],
  ): string {
    return this.mode === 'approved_cloud'
      ? deidentifyText(query, directIdentifiers)
      : query;
  }
}

function deidentifyContentPart(
  part: ContentPart,
  directIdentifiers: readonly string[],
): ContentPart {
  return {
    ...part,
    ...(typeof part.text === 'string'
      ? { text: deidentifyText(part.text, directIdentifiers) }
      : {}),
    ...(typeof part.content === 'string'
      ? { content: deidentifyText(part.content, directIdentifiers) }
      : {}),
  };
}

function deidentifyText(value: string, directIdentifiers: readonly string[]): string {
  let result = value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[已去标识化邮箱]')
    .replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, '[已去标识化电话]')
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, '[已去标识化证件号]');

  const identifiers = [...new Set(
    directIdentifiers
      .map(identifier => identifier.trim())
      .filter(identifier => identifier.length >= 2),
  )].sort((left, right) => right.length - left.length);

  for (const identifier of identifiers) {
    result = result.split(identifier).join('[已去标识化]');
  }

  return result;
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized.endsWith('.internal')
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80:')
  ) {
    return true;
  }

  const octets = normalized.split('.').map(Number);
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}
