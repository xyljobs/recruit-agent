import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTenantAiExecutionMode } from './gateway';

test('tenant AI policy fails closed when tenant and deployment modes differ', () => {
  assert.equal(resolveTenantAiExecutionMode({
    deploymentMode: 'approved_cloud',
    deploymentProcessors: ['processor-a'],
    tenantMode: 'private_endpoint',
    tenantProcessors: [],
  }), 'rules_only');
});

test('approved cloud requires the tenant to approve every deployment processor', () => {
  assert.equal(resolveTenantAiExecutionMode({
    deploymentMode: 'approved_cloud',
    deploymentProcessors: ['processor-a', 'processor-b'],
    tenantMode: 'approved_cloud',
    tenantProcessors: ['processor-a'],
  }), 'rules_only');
  assert.equal(resolveTenantAiExecutionMode({
    deploymentMode: 'approved_cloud',
    deploymentProcessors: ['processor-a', 'processor-b'],
    tenantMode: 'approved_cloud',
    tenantProcessors: ['processor-b', 'processor-a'],
  }), 'approved_cloud');
});

test('approved cloud also requires the candidate notice to name every processor', () => {
  assert.equal(resolveTenantAiExecutionMode({
    deploymentMode: 'approved_cloud',
    deploymentProcessors: ['processor-a', 'processor-b'],
    tenantMode: 'approved_cloud',
    tenantProcessors: ['processor-a', 'processor-b'],
    candidateProcessors: ['processor-a'],
  }), 'rules_only');
  assert.equal(resolveTenantAiExecutionMode({
    deploymentMode: 'approved_cloud',
    deploymentProcessors: ['processor-a', 'processor-b'],
    tenantMode: 'approved_cloud',
    tenantProcessors: ['processor-a', 'processor-b'],
    candidateProcessors: ['processor-b', 'processor-a'],
  }), 'approved_cloud');
});

test('private endpoint requires explicit tenant approval of private mode', () => {
  assert.equal(resolveTenantAiExecutionMode({
    deploymentMode: 'private_endpoint',
    deploymentProcessors: [],
    tenantMode: 'private_endpoint',
    tenantProcessors: [],
  }), 'private_endpoint');
  assert.equal(resolveTenantAiExecutionMode({
    deploymentMode: 'private_endpoint',
    deploymentProcessors: [],
    tenantMode: undefined,
    tenantProcessors: [],
  }), 'rules_only');
});
