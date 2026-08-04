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

export class Config {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly timeout?: number;

  constructor(options: ConfigOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? options.modelBaseUrl ?? process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL;
    this.timeout = options.timeout;
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

  constructor(config = new Config(), customHeaders: Record<string, string> = {}) {
    const apiKey = config.apiKey ?? process.env.LLM_API_KEY;
    if (!apiKey) {
      throw new Error('LLM_API_KEY is not set');
    }

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
      model: options.model ?? process.env.LLM_MODEL ?? DEFAULT_MODEL,
      messages: toOpenAiMessages(messages),
      temperature: options.temperature,
      response_format: options.responseFormat,
      stream: true,
    });

    for await (const chunk of response) {
      const content = chunk.choices[0]?.delta.content;
      if (content) {
        yield { content };
      }
    }
  }

  async invoke(
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): Promise<{ content: string }> {
    const response = await this.client.chat.completions.create({
      model: options.model ?? process.env.LLM_MODEL ?? DEFAULT_MODEL,
      messages: toOpenAiMessages(messages),
      temperature: options.temperature,
      response_format: options.responseFormat,
    });

    return { content: response.choices[0]?.message.content ?? '' };
  }
}
