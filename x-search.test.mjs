import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXPosts, scanXSearch } from './x-search.mjs';

const now = Date.parse('2026-11-18T10:00:00Z');
const post = (name, code) => ({
  text: 'Claude guest pass https://t.co/example',
  url: `https://x.com/${name}/status/1234567890`,
  createdAt: '2026-11-18T09:59:30Z',
  entities: { urls: [`https://claude.ai/referral/${code}?s=ios`] },
});

test('X search accepts any author and reads expanded URLs', () => {
  const passes = parseXPosts([post('firstTimeSharer', 'freshCode1'), post('anotherUser', 'freshCode2')], now);
  assert.deepEqual(passes.map(pass => pass.code), ['freshCode1', 'freshCode2']);
  assert.equal(passes[0].source, 'https://x.com/firstTimeSharer/status/1234567890');
});

test('X search uses keywords without account restrictions and follows pagination', async () => {
  const calls = [];
  const request = async (url, options) => {
    if (url.endsWith('/usage')) return Response.json({ data: { freeGrant: { remaining: 100 } } });
    const body = JSON.parse(options.body);
    calls.push(body);
    return body.cursor ? Response.json({ data: [post('newUser', 'freshCode2')], meta: {} }) : Response.json({ data: [post('anyUser', 'freshCode1')], meta: { nextCursor: 'page-two' } });
  };
  const result = await scanXSearch('test-key', {}, now, request);
  assert.equal(result.passes.length, 2);
  assert.equal(calls[0].query, 'url:claude.ai/referral -filter:nativeretweets');
  assert.equal(calls[0].since, '2026-11-18T09:40:00.000Z');
  assert.equal(calls[0].fromUsers, undefined);
  assert.equal(calls[1].cursor, 'page-two');
  assert.deepEqual(result.checkpoint, { completedAt: '2026-11-18T10:00:00.000Z' });
});

test('X search refuses to use a paid balance after free credits run out', async () => {
  let calls = 0;
  const request = async () => {
    calls += 1;
    return Response.json({ data: { available: 50_000, freeGrant: { remaining: 0 } } });
  };
  await assert.rejects(scanXSearch('test-key', {}, now, request), /free.*exhausted/i);
  assert.equal(calls, 1);
});
