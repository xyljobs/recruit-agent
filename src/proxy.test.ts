import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

test('competition-default deployment blocks Boss page and API before authentication', async () => {
  const previous = process.env.ENABLE_BOSS_SEARCH;
  delete process.env.ENABLE_BOSS_SEARCH;

  try {
    const pageResponse = await proxy(new NextRequest('http://localhost/boss-search'));
    assert.equal(pageResponse.status, 404);

    const apiResponse = await proxy(new NextRequest('http://localhost/api/boss-search/status'));
    assert.equal(apiResponse.status, 404);
    assert.deepEqual(await apiResponse.json(), {
      success: false,
      error: '此部署未启用外部平台浏览器自动化',
    });
  } finally {
    if (previous === undefined) delete process.env.ENABLE_BOSS_SEARCH;
    else process.env.ENABLE_BOSS_SEARCH = previous;
  }
});
