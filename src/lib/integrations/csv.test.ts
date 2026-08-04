import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIntegrationCsv } from './csv';

test('CSV baseline accepts structured entity and authorization JSON', () => {
  const records = parseIntegrationCsv([
    'external_id,data_json,authorization_json',
    'candidate-1,"{ ""name"": ""张三"" }","{ ""confirmed"": true }"',
  ].join('\n'));
  assert.deepEqual(records, [{
    external_id: 'candidate-1',
    data: { name: '张三' },
    authorization: { confirmed: true },
  }]);
});

test('CSV baseline rejects rows that are neither mappings nor entities', () => {
  assert.throws(
    () => parseIntegrationCsv('external_id,local_entity_id\ncandidate-1,'),
    /本地实体 ID 或实体 data_json/,
  );
});
