import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AiExecutionPolicy,
  AiExecutionPolicyError,
} from './execution-policy';
import { AiExecutionGateway } from './gateway';
import type { ChatMessage } from './llm';

test('rules_only blocks model and knowledge calls before client construction', () => {
  let modelClientsConstructed = 0;
  let knowledgeClientsConstructed = 0;
  const policy = new AiExecutionPolicy('rules_only', {});
  const gateway = new AiExecutionGateway({
    policy,
    llmClientFactory: () => {
      modelClientsConstructed += 1;
      return createLlmStub();
    },
    knowledgeClientFactory: () => {
      knowledgeClientsConstructed += 1;
      return createKnowledgeStub();
    },
  });

  assert.throws(
    () => gateway.stream([{ role: 'user', content: 'test' }]),
    isBlockedError,
  );
  assert.throws(
    () => gateway.searchKnowledge('test'),
    isBlockedError,
  );
  assert.equal(modelClientsConstructed, 0);
  assert.equal(knowledgeClientsConstructed, 0);
});

test('private_endpoint uses a configured private endpoint without rewriting payloads', async () => {
  let constructedBaseUrl = '';
  let receivedMessages: ChatMessage[] = [];
  const policy = new AiExecutionPolicy('private_endpoint', {
    LLM_BASE_URL: 'http://10.20.30.40/v1',
    LLM_MODEL: 'private-model',
  });
  const gateway = new AiExecutionGateway({
    policy,
    llmClientFactory: config => {
      constructedBaseUrl = config.baseUrl;
      return createLlmStub(messages => {
        receivedMessages = messages;
      });
    },
  });

  for await (const _chunk of gateway.stream([
    { role: 'user', content: '候选人 张三 13800138000' },
  ])) {
    // Consume the probe stream.
  }

  assert.equal(constructedBaseUrl, 'http://10.20.30.40/v1');
  assert.equal(policy.modelName, 'private-model');
  assert.equal(receivedMessages[0]?.content, '候选人 张三 13800138000');
});

test('approved_cloud constructs the approved endpoint client and de-identifies payloads', async () => {
  let clientsConstructed = 0;
  let receivedMessages: ChatMessage[] = [];
  const policy = new AiExecutionPolicy('approved_cloud', {
    APPROVED_CLOUD_LLM_BASE_URL: 'https://approved.example.test/v1',
  });
  const gateway = new AiExecutionGateway({
    policy,
    llmClientFactory: config => {
      clientsConstructed += 1;
      assert.equal(config.baseUrl, 'https://approved.example.test/v1');
      return createLlmStub(messages => {
        receivedMessages = messages;
      });
    },
  });

  for await (const _chunk of gateway.stream(
    [{ role: 'user', content: '张三 13800138000 zhangsan@example.com 在示例科技任职' }],
    {},
    { directIdentifiers: ['张三', '示例科技'] },
  )) {
    // Consume the probe stream.
  }

  assert.equal(clientsConstructed, 1);
  const content = receivedMessages[0]?.content;
  assert.equal(typeof content, 'string');
  assert.doesNotMatch(content as string, /张三|示例科技|13800138000|zhangsan@example\.com/);
});

test('missing and unknown modes both fail closed to rules_only', () => {
  const missing = AiExecutionPolicy.fromEnvironment({});
  const unknown = AiExecutionPolicy.fromEnvironment({
    AI_EXECUTION_MODE: 'experimental_cloud',
    LLM_BASE_URL: 'https://unapproved.example.test/v1',
  });
  let clientsConstructed = 0;
  const gateway = new AiExecutionGateway({
    policy: unknown,
    llmClientFactory: () => {
      clientsConstructed += 1;
      return createLlmStub();
    },
  });

  assert.equal(missing.mode, 'rules_only');
  assert.equal(unknown.mode, 'rules_only');
  assert.throws(
    () => gateway.stream([{ role: 'user', content: 'test' }]),
    isBlockedError,
  );
  assert.equal(clientsConstructed, 0);
});

test('approved cloud rejects a plaintext HTTP model endpoint', () => {
  const policy = new AiExecutionPolicy('approved_cloud', {
    APPROVED_CLOUD_LLM_BASE_URL: 'http://model.example/v1',
  });
  assert.throws(() => policy.getModelBaseUrl(), /必须使用 HTTPS/);
});

function createLlmStub(onStream?: (messages: ChatMessage[]) => void) {
  return {
    async *stream(messages: ChatMessage[]) {
      onStream?.(messages);
      yield { content: 'ok' };
    },
    async invoke(messages: ChatMessage[]) {
      onStream?.(messages);
      return { content: 'ok' };
    },
  };
}

function createKnowledgeStub() {
  return {
    async search() {
      return { code: 0, msg: 'success', chunks: [] };
    },
  };
}

function isBlockedError(error: unknown): boolean {
  return error instanceof AiExecutionPolicyError
    && error.code === 'AI_EXECUTION_BLOCKED';
}
