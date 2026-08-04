import {
  Config,
  HeaderUtils,
  LLMClient,
  type ChatMessage,
  type CompletionOptions,
} from './llm';
import { KnowledgeClient } from './knowledge';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AiExecutionPolicy,
  resolveAiExecutionMode,
  type AiExecutionMode,
} from './execution-policy';

type LlmClientContract = Pick<LLMClient, 'stream' | 'invoke'>;
type KnowledgeClientContract = Pick<KnowledgeClient, 'search'>;

interface AiExecutionGatewayOptions {
  policy?: AiExecutionPolicy;
  requestHeaders?: Headers;
  llmClientFactory?: (
    config: Config,
    customHeaders: Record<string, string>,
  ) => LlmClientContract;
  knowledgeClientFactory?: () => KnowledgeClientContract;
}

export interface AiPayloadOptions {
  directIdentifiers?: readonly string[];
}

export class AiExecutionGateway {
  readonly policy: AiExecutionPolicy;
  private readonly customHeaders: Record<string, string>;
  private readonly llmClientFactory: NonNullable<AiExecutionGatewayOptions['llmClientFactory']>;
  private readonly knowledgeClientFactory: NonNullable<AiExecutionGatewayOptions['knowledgeClientFactory']>;
  private llmClient: LlmClientContract | null = null;
  private knowledgeClient: KnowledgeClientContract | null = null;

  constructor(options: AiExecutionGatewayOptions = {}) {
    this.policy = options.policy ?? AiExecutionPolicy.fromEnvironment();
    this.customHeaders = options.requestHeaders
      ? HeaderUtils.extractForwardHeaders(options.requestHeaders)
      : {};
    this.llmClientFactory = options.llmClientFactory
      ?? ((config, customHeaders) => new LLMClient(config, customHeaders));
    this.knowledgeClientFactory = options.knowledgeClientFactory
      ?? (() => new KnowledgeClient());
  }

  get mode() {
    return this.policy.mode;
  }

  get canUseModel(): boolean {
    return this.policy.allowsExternalAi;
  }

  get canUseKnowledge(): boolean {
    return this.policy.allowsExternalAi;
  }

  requireModel(): void {
    this.policy.getModelBaseUrl();
  }

  stream(
    messages: ChatMessage[],
    completionOptions: CompletionOptions = {},
    payloadOptions: AiPayloadOptions = {},
  ): AsyncGenerator<{ content: string }> {
    const client = this.getLlmClient();
    return client.stream(
      this.policy.prepareMessages(messages, payloadOptions.directIdentifiers),
      completionOptions,
    );
  }

  invoke(
    messages: ChatMessage[],
    completionOptions: CompletionOptions = {},
    payloadOptions: AiPayloadOptions = {},
  ): Promise<{ content: string }> {
    const client = this.getLlmClient();
    return client.invoke(
      this.policy.prepareMessages(messages, payloadOptions.directIdentifiers),
      completionOptions,
    );
  }

  searchKnowledge(
    query: string,
    tableNames?: string[],
    topK?: number,
    minScore?: number,
    payloadOptions: AiPayloadOptions = {},
  ) {
    this.policy.assertExternalCallAllowed('knowledge');

    if (!this.knowledgeClient) {
      this.knowledgeClient = this.knowledgeClientFactory();
    }

    return this.knowledgeClient.search(
      this.policy.prepareKnowledgeQuery(query, payloadOptions.directIdentifiers),
      tableNames,
      topK,
      minScore,
    );
  }

  private getLlmClient(): LlmClientContract {
    const baseUrl = this.policy.getModelBaseUrl();
    if (!this.llmClient) {
      this.llmClient = this.llmClientFactory(
        new Config({ baseUrl }),
        this.customHeaders,
      );
    }
    return this.llmClient;
  }
}

export function createAiExecutionGateway(requestHeaders?: Headers): AiExecutionGateway {
  return new AiExecutionGateway({ requestHeaders });
}

/**
 * The deployment policy is an upper bound. A tenant must explicitly approve
 * the same mode; approved-cloud mode additionally requires every declared
 * deployment processor to be present in the tenant approval snapshot.
 */
export async function createTenantAiExecutionGateway(
  supabase: SupabaseClient,
  organizationId: string,
  requestHeaders?: Headers,
  candidateApprovedProcessors?: readonly string[],
): Promise<AiExecutionGateway> {
  const deploymentPolicy = AiExecutionPolicy.fromEnvironment();
  const { data, error } = await supabase
    .from('organizations')
    .select('ai_execution_mode, approved_cloud_processors')
    .eq('id', organizationId)
    .maybeSingle();

  let effectiveMode: AiExecutionMode = 'rules_only';
  if (!error && data) {
    effectiveMode = resolveTenantAiExecutionMode({
      deploymentMode: deploymentPolicy.mode,
      deploymentProcessors: parseProcessorList(process.env.APPROVED_CLOUD_PROCESSORS),
      tenantMode: data.ai_execution_mode,
      tenantProcessors: data.approved_cloud_processors,
      candidateProcessors: candidateApprovedProcessors,
    });
  }

  return new AiExecutionGateway({
    requestHeaders,
    policy: new AiExecutionPolicy(effectiveMode),
  });
}

export function resolveTenantAiExecutionMode(input: {
  deploymentMode: unknown;
  deploymentProcessors: readonly string[];
  tenantMode: unknown;
  tenantProcessors: unknown;
  candidateProcessors?: unknown;
}): AiExecutionMode {
  const deploymentMode = resolveAiExecutionMode(input.deploymentMode);
  const tenantMode = resolveAiExecutionMode(input.tenantMode);
  if (deploymentMode !== tenantMode) return 'rules_only';
  if (tenantMode !== 'approved_cloud') return tenantMode;
  const tenantProcessors = Array.isArray(input.tenantProcessors)
    ? input.tenantProcessors.filter((value): value is string => typeof value === 'string')
    : [];
  const candidateProcessors = input.candidateProcessors === undefined
    ? null
    : Array.isArray(input.candidateProcessors)
      ? input.candidateProcessors.filter((value): value is string => typeof value === 'string')
      : [];
  return input.deploymentProcessors.length > 0
    && input.deploymentProcessors.every(processor => tenantProcessors.includes(processor))
    && (candidateProcessors === null
      || input.deploymentProcessors.every(processor => candidateProcessors.includes(processor)))
    ? 'approved_cloud'
    : 'rules_only';
}

function parseProcessorList(value: string | undefined): string[] {
  return [...new Set((value ?? '')
    .split(',')
    .map(processor => processor.trim())
    .filter(Boolean))];
}
