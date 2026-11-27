import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPasses, parseDirectory, parseFeed } from './parsers.mjs';

const now = Date.parse('2026-11-18T10:00:00Z');
const recent = new Date(now - 20 * 60_000);

test('normalizes and deduplicates valid official URLs while removing crossed-out links', () => {
  const passes = extractPasses('<s>https://claude.ai/referral/usedCode12</s><a href="https://claude.ai/referral/freshCode1?s=ios">pass</a> https://claude.ai/referral/freshCode1?x=1 https://fakeclaude.ai/referral/otherCode1', 'https://example.com', recent, now);
  assert.deepEqual(passes.map(pass => pass.url), ['https://claude.ai/referral/freshCode1']);
});

test('rejects stale, undated, and explicitly claimed offers', () => {
  for (const date of [new Date(now - 20 * 60_000 - 1), new Date(now - 3 * 3_600_000), new Date(now + 1), new Date('invalid')]) {
    assert.equal(extractPasses('https://claude.ai/referral/freshCode1', 'source', date, now).length, 0);
  }
  assert.equal(extractPasses('All passes are claimed. https://claude.ai/referral/freshCode1', 'source', recent, now).length, 0);
  assert.equal(extractPasses("I haven't used these. https://claude.ai/referral/freshCode1", 'source', recent, now).length, 1);
});

test('reads RSS publication dates and ignores old entries', () => {
  const feed = '<rss><channel><item><link>https://example.com/post</link><pubDate>Wed, 18 Nov 2026 09:59:30 GMT</pubDate><description><![CDATA[<a href="https://claude.ai/referral/freshCode1?s=ios">pass</a>]]></description></item></channel></rss>';
  assert.equal(parseFeed(feed, now)[0].published, '2026-11-18T09:59:30.000Z');
  assert.throws(() => parseFeed('<html>Access denied</html>', now));
});

test('directory dates belong to each code and retired codes stay excluded', () => {
  const row = (code, status, age) => `<tr><td>https://claude.ai/referral/${code}?s=ios</td><td>${status}</td><td>1</td><td>${age}</td></tr>`;
  const html = `<table>${row('freshCode1', 'Live', '42 sec ago')}${row('oldCode123', 'Live', '21m ago')}${row('usedCode12', 'Retired', '10s ago')}</table>`;
  assert.deepEqual(parseDirectory(html, now, now).map(pass => pass.code), ['freshCode1']);
});
