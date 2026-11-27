import { extractPasses, MAX_PASS_AGE_MS } from './parsers.mjs';

export function parseRedditPosts(posts, now = Date.now()) {
  return posts.flatMap(post => {
    if (post.removedByCategory || ['[removed]', '[deleted]'].includes(post.selftext)) return [];
    const text = [post.title, post.selftext, post.urlOverriddenByDest].filter(Boolean).join('\n').replace(/~~[\s\S]*?~~/g, '');
    const markup = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const source = `https://www.reddit.com${post.permalink}`;
    return extractPasses(markup, source, new Date(post.createdAt), now);
  });
}

export async function scanRedditSearch(apiKey, previous = {}, now = Date.now(), request = fetch) {
  if (!apiKey) throw new Error('Reddit public search needs the WEIR_API_KEY secret');
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const usage = await request('https://api.weirapp.io/v1/usage', { headers, signal: AbortSignal.timeout(25_000) });
  if (!usage.ok) throw new Error(`Search provider usage returned HTTP ${usage.status}`);
  const time = 'hour';
  let cursor = previous.time === time && now - Date.parse(previous.startedAt) < MAX_PASS_AGE_MS ? previous.cursor : undefined;
  const startedAt = cursor ? previous.startedAt : new Date(now).toISOString();
  const passes = [];
  for (let page = 0; page < 3; page += 1) {
    const options = {
      method: 'POST', headers,
      body: JSON.stringify({
        query: 'url:claude.ai/referral OR "claude.ai/referral/"',
        sort: 'new', time, limit: 20,
        ...(cursor ? { cursor } : {}),
      }),
      signal: AbortSignal.timeout(25_000),
    };
    let response;
    try {
      response = await request('https://api.weirapp.io/v1/reddit/search', options);
    } catch (error) {
      if (page > 0 && error.budgetPaused) break;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`Reddit search provider returned HTTP ${response.status}`);
      error.status = response.status;
      error.freeQuotaExhausted = response.status === 402;
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) error.retryAt = /^\d+$/.test(retryAfter) ? now + Number(retryAfter) * 1000 : Date.parse(retryAfter);
      throw error;
    }
    const payload = await response.json();
    if (!Array.isArray(payload.data)) throw new Error('Reddit search response is missing posts');
    passes.push(...parseRedditPosts(payload.data, now));
    cursor = payload.meta?.nextCursor;
    const oldest = payload.data.at(-1);
    if (!cursor || (oldest && Date.parse(oldest.createdAt) < now - MAX_PASS_AGE_MS)) {
      cursor = undefined;
      break;
    }
  }
  return { passes, checkpoint: cursor ? { time, cursor, startedAt } : { completedAt: new Date(now).toISOString() } };
}
