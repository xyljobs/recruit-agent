import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeIntegrationConnections,
  normalizeShortlistRuns,
  outcomeReasonLabel,
} from './decision-ui';

describe('decision workspace API adapters', () => {
  it('accepts both current array and compatibility runs envelope', () => {
    const run = { id: 'run-1', entries: [] };
    assert.deepEqual(normalizeShortlistRuns([run]), [run]);
    assert.deepEqual(normalizeShortlistRuns({ runs: [run] }), [run]);
    assert.deepEqual(normalizeShortlistRuns(undefined), []);
  });

  it('derives explicit enablement and latest sync state from integration API rows', () => {
    const [connection] = normalizeIntegrationConnections([{
      id: 'source-1',
      name: '授权简历源',
      connector_type: 'authorized_resume_source',
      status: 'enabled',
      latest_sync: { status: 'succeeded', finished_at: '2026-08-01T00:00:00Z' },
    }]);
    assert.equal(connection.enabled, true);
    assert.equal(connection.connection_type, 'authorized_resume_source');
    assert.equal(connection.last_sync_status, 'succeeded');
  });

  it('requires an accountable reason for adverse and candidate-rights outcomes', () => {
    assert.equal(outcomeReasonLabel('rejected'), '拒绝原因（必填）');
    assert.equal(outcomeReasonLabel('withdrawn'), '撤回原因（必填）');
    assert.equal(outcomeReasonLabel('complaint'), '投诉分类（必填）');
    assert.equal(outcomeReasonLabel('hired'), null);
  });
});
