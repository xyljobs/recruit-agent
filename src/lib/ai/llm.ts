import OpenAI from 'openai';

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen-plus';

export interface ContentPart {
  type?: string;
  text?: string;
  content?: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  responseFormat?: OpenAI.Chat.Completions.ChatCompletionCreateParams['response_format'];
  /** 关闭思考模型的隐式推理（qwen enable_thinking），结构化抽取类任务可大幅降低首 token 延迟 */
  enableThinking?: boolean;
  thinking?: unknown;
  caching?: unknown;
  streaming?: unknown;
}

interface ConfigOptions {
  apiKey?: string;
  baseUrl?: string;
  modelBaseUrl?: string;
  timeout?: number;
  [key: string]: unknown;
}

/** 单次模型请求超时（毫秒）：连接/首包由 SDK timeout 兜底，流式数据停顿由 stream 内看门狗兜底 */
const DEFAULT_TIMEOUT_MS =
  Number(process.env.LLM_TIMEOUT_MS) > 0
    ? Number(process.env.LLM_TIMEOUT_MS)
    : 60_000;

export class Config {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly timeout: number;

  constructor(options: ConfigOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? options.modelBaseUrl ?? process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL;
    this.timeout =
      typeof options.timeout === 'number' && options.timeout > 0
        ? options.timeout
        : DEFAULT_TIMEOUT_MS;
  }
}

export class HeaderUtils {
  static extractForwardHeaders(_headers: Headers): Record<string, string> {
    return {};
  }
}

function contentToText(content: ChatMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .map(part => part.text ?? part.content ?? JSON.stringify(part))
    .join('\n');
}

function toOpenAiMessages(
  messages: ChatMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map(message => {
    const content = contentToText(message.content);
    switch (message.role) {
      case 'system':
        return { role: 'system', content };
      case 'assistant':
        return { role: 'assistant', content };
      default:
        return { role: 'user', content };
    }
  });
}

export class LLMClient {
  private readonly client: OpenAI;
  private readonly timeoutMs: number;

  constructor(config = new Config(), customHeaders: Record<string, string> = {}) {
    const apiKey = config.apiKey ?? process.env.LLM_API_KEY;
    if (!apiKey) {
      throw new Error('LLM_API_KEY is not set');
    }

    this.timeoutMs = config.timeout;
    this.client = new OpenAI({
      apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeout,
      defaultHeaders: Object.keys(customHeaders).length > 0 ? customHeaders : undefined,
    });
  }

  async *stream(
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): AsyncGenerator<{ content: string }> {
    const response = await this.client.chat.completions.create({
      ...this.buildCompletionParams(messages, options),
      stream: true,
    });

    // 看门狗：SDK timeout 只覆盖到响应头，流式 token 中途停顿（供应商排队/挂起）会无限等待，
    // 这里对「距上一个 chunk 的间隔」计时，超时则中止迭代，由调用方走降级逻辑
    const iterator = response[Symbol.asyncIterator]();
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `模型响应超时：已 ${Math.round(this.timeoutMs / 1000)} 秒未返回新数据`,
              ),
            ),
          this.timeoutMs,
        );
      });
      let result: IteratorResult<OpenAI.Chat.Completions.ChatCompletionChunk>;
      try {
        result = await Promise.race([iterator.next(), timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (result.done) break;
      const content = result.value.choices[0]?.delta?.content;
      if (content) {
        yield { content };
      }
    }
  }

  async invoke(
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): Promise<{ content: string }> {
    const response = await this.client.chat.completions.create(
      this.buildCompletionParams(messages, options),
    );

    return { content: response.choices[0]?.message.content ?? '' };
  }

  private buildCompletionParams(
    messages: ChatMessage[],
    options: CompletionOptions,
  ): Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, 'stream'> {
    const params: Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, 'stream'> = {
      model: options.model ?? process.env.LLM_MODEL ?? DEFAULT_MODEL,
      messages: toOpenAiMessages(messages),
      temperature: options.temperature,
      response_format: options.responseFormat,
    };
    // qwen 思考模型默认会先生成大量隐式推理 token；结构化抽取类任务显式关闭
    if (options.enableThinking === false) {
      return Object.assign(params, { enable_thinking: false });
    }
    return params;
  }
}
