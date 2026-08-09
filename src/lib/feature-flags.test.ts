import assert from 'node:assert/strict';
import test from 'node:test';
import { isBossSearchEnabled } from './feature-flags';

test('Boss browser automation is disabled unless explicitly enabled', () => {
  assert.equal(isBossSearchEnabled(undefined), false);
  assert.equal(isBossSearchEnabled(''), false);
  assert.equal(isBossSearchEnabled('false'), false);
  assert.equal(isBossSearchEnabled('1'), false);
  assert.equal(isBossSearchEnabled(' true '), true);
  assert.equal(isBossSearchEnabled('TRUE'), true);
});
