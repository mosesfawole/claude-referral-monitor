import { load } from 'cheerio';
import { createHash } from 'node:crypto';

export const MAX_PASS_AGE_MINUTES = 20;
export const MAX_PASS_AGE_MS = MAX_PASS_AGE_MINUTES * 60_000;

export const codeHash = code => createHash('sha256').update(code).digest('hex');

export function publicationTime(value, referenceTime = Date.now()) {
  const relative = value.trim().match(/^(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hours?|d|days?)\s+ago$/i);
  if (relative) {
    const unit = relative[2].toLowerCase()[0];
    const duration = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
    return new Date(referenceTime - Number(relative[1]) * duration);
  }
  return new Date(value);
}

export function isFresh(date, now = Date.now()) {
  const age = now - date.getTime();
  return Number.isFinite(age) && age >= 0 && age <= MAX_PASS_AGE_MS;
}

export function explicitlyUnavailable(text) {
  return /\b(?:all\s+(?:\d+\s+)?(?:passes|referrals|codes|links)\s+(?:have\s+been\s+|are\s+)?(?:used|claimed|taken)|already\s+(?:claimed|redeemed|used|taken)|no\s+(?:guest\s+)?passes\s+left|no\s+longer\s+(?:valid|available)|expired)\b|全部领完|全部用完|已失效|已领完/i.test(text);
}

export function extractPasses(markup, source, published, now = Date.now()) {
  if (!isFresh(published, now)) return [];
  const $ = load(markup);
  $('s, del, strike, script, style, blockquote').remove();
  if (explicitlyUnavailable($.text())) return [];
  const content = $.text() + ' ' + $('a[href]').map((_, element) => $(element).attr('href')).get().join(' ');
  const matches = content.matchAll(/https:\/\/claude\.ai\/referral\/([a-zA-Z0-9_-]{6,64})(?=[\s?&#"'<>.,!)]|$)/g);
  const codes = [...new Set([...matches].map(match => match[1]))];
  return codes.map(code => ({ code, url: `https://claude.ai/referral/${code}`, source, published: published.toISOString() }));
}

export function feedEntries(xml, now = Date.now()) {
  const $ = load(xml, { xml: true });
  if (!$('rss, feed').length) throw new Error('Response is not an RSS or Atom feed');
  return $('item, entry').toArray().map(element => {
    const entry = $(element);
    const published = publicationTime(entry.find('published, pubDate').first().text(), now);
    const source = entry.find('link[rel="alternate"]').attr('href') || entry.find('link').attr('href') || entry.find('link').first().text();
    const markup = entry.find('description, content, content\\:encoded').map((_, part) => $(part).text()).get().join('\n');
    return { source, published, markup };
  });
}

export function parseFeed(xml, now = Date.now()) {
  return feedEntries(xml, now).flatMap(entry => extractPasses(entry.markup, entry.source, entry.published, now));
}

export function parseDirectory(html, referenceTime = Date.now(), now = Date.now()) {
  const $ = load(html);
  if (!$('table').length) throw new Error('Directory table missing or blocked');
  const passes = [];
  $('tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 4) return;
    const status = cells.eq(1).text().trim();
    if (!/^(live|unverified)$/i.test(status)) return;
    const published = publicationTime(cells.eq(3).text(), referenceTime);
    passes.push(...extractPasses(cells.eq(0).html() || '', 'https://claudecoworkcourse.com/claude-guest-passes', published, now));
  });
  return passes;
}
