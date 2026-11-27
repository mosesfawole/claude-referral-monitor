import { isFresh, MAX_PASS_AGE_MINUTES } from './parsers.mjs';

export const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export const commands = [
  { command: 'menu', description: 'Open your dashboard' },
  { command: 'latest', description: 'Show recent guest passes' },
  { command: 'status', description: 'See when the monitor last checked' },
  { command: 'sources', description: 'See which sources are working' },
  { command: 'budget', description: 'View your free-credit budget' },
  { command: 'settings', description: 'Change the check interval' },
  { command: 'pause', description: 'Pause searches and alerts' },
  { command: 'resume', description: 'Resume monitoring' },
  { command: 'help', description: 'How to use the bot' },
];

export const replyKeyboard = {
  keyboard: [['📡 Status', '🎟 Recent finds'], ['⚙️ Settings', '❔ Help']],
  resize_keyboard: true, is_persistent: true,
};

export function sourceName(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (['x.com', 'twitter.com'].includes(host)) return 'X';
    if (host === 'reddit.com') return 'Reddit';
    if (host === 'nodeloc.com') return 'NodeLoc';
    if (host === 'news.ycombinator.com') return 'Hacker News';
    return host === 'claudecoworkcourse.com' ? 'Guest-pass directory' : host;
  } catch { return 'Public post'; }
}

function age(date, now) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(date)) / 1_000));
  if (!Number.isFinite(seconds)) return 'Time unavailable';
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} hr ago` : `${Math.floor(hours / 24)} day ago`;
}

export function homeKeyboard(controls) {
  return { inline_keyboard: [
    [{ text: '🎟 Recent finds', callback_data: 'latest' }, { text: '📡 Status', callback_data: 'status' }],
    [{ text: '🌐 Sources', callback_data: 'sources' }, { text: '🌱 Free budget', callback_data: 'budget' }],
    [{ text: '⚙️ Settings', callback_data: 'settings' }, { text: controls.paused ? '▶️ Resume' : '⏸ Pause', callback_data: controls.paused ? 'resume' : 'pause' }],
  ] };
}

export function passKeyboard(passes, used = []) {
  return { inline_keyboard: [
    ...passes.map((pass, index) => used.includes(pass.hash)
      ? [{ text: `✓ Pass ${index + 1} marked used`, callback_data: 'noop' }, { text: 'Source', url: pass.source }]
      : [{ text: passes.length === 1 ? '🎟 Open pass' : `🎟 Open pass ${index + 1}`, url: pass.url },
        { text: 'Source', url: pass.source }, { text: 'Used', callback_data: `used:${pass.hash}` }]),
    [{ text: '☰ Menu', callback_data: 'menu' }],
  ] };
}

export function passCard(passes, used = [], now = Date.now(), recent = false) {
  const title = recent ? '🎟 Recent guest passes' : passes.length === 1 ? '🎟 A fresh Claude Pro pass' : `🎟 ${passes.length} fresh Claude Pro passes`;
  const lines = passes.map((pass, index) => `${passes.length > 1 ? `${index + 1}. ` : ''}<b>${escapeHtml(sourceName(pass.source))}</b> · ${age(pass.published, now)}${used.includes(pass.hash) ? ' · Used' : ''}`);
  return {
    text: `<b>${title}</b>\n\n${lines.join('\n')}\n\n7-day trial · Availability unverified\nTap Open pass to try it. Mark it Used if it has been claimed.`,
    reply_markup: passKeyboard(passes, used),
  };
}

export function renderScreen(screen, controls, snapshot, now = Date.now()) {
  const menu = homeKeyboard(controls);
  if (screen === 'latest') {
    const recent = (snapshot.recent || []).filter(pass => !controls.used.includes(pass.hash) && isFresh(new Date(pass.published), now)).sort((a, b) => Date.parse(b.published) - Date.parse(a.published)).slice(0, 5);
    return recent.length ? passCard(recent, controls.used, now, true) : {
      text: `<b>🎟 Recent finds</b>\n\nNo passes from the last ${MAX_PASS_AGE_MINUTES} minutes. Fresh alerts arrive automatically.`, reply_markup: menu,
    };
  }
  if (screen === 'sources') {
    const ready = snapshot.sources?.available || [];
    const unavailable = snapshot.sources?.unavailable || [];
    return { text: `<b>🌐 Sources</b>\n\n${ready.map(name => `🟢 ${escapeHtml(name)}`).join('\n') || 'Waiting for the first scan.'}${unavailable.length ? `\n\n${unavailable.map(name => `🟠 ${escapeHtml(name)}`).join('\n')}\n\nOrange sources are temporarily unavailable and will be retried.` : ''}\n\nX keyword search can find posts from any public account.`, reply_markup: menu };
  }
  if (screen === 'budget') {
    const budget = snapshot.credits;
    return { text: `<b>🌱 Free-credit budget</b>\n\n${budget ? `Search credits used today <b>${budget.spent}</b>\nDaily limit <b>${budget.dailyLimit}</b>${Number.isInteger(budget.freeRemaining) ? `\nFree credits remaining <b>${budget.freeRemaining.toLocaleString('en-GB')}</b>` : ''}` : 'Budget details will appear after the next scan.'}\n\nThe daily limit adapts to your remaining free credits. Searches pause at the limit and resume when the budget resets.\n\nOpening this menu costs no search credits.`, reply_markup: menu };
  }
  if (screen === 'settings') return {
    text: `<b>⚙️ Check interval</b>\n\nCurrently every <b>${controls.intervalMinutes} minutes</b>.\nChoose a pace that fits your free-credit budget.\n\n30 min · Find fresh links sooner\n60 min · Use fewer search credits\n2 hours · Lowest usage\n\nScheduled runs can be delayed by GitHub.`,
    reply_markup: { inline_keyboard: [
      [30, 60, 120].map(value => ({ text: `${controls.intervalMinutes === value ? '✓ ' : ''}${value === 120 ? '2 hours' : `${value} min`}`, callback_data: `interval:${value}` })),
      [{ text: controls.paused ? '▶️ Resume monitoring' : '⏸ Pause monitoring', callback_data: controls.paused ? 'resume' : 'pause' }],
      [{ text: '‹ Menu', callback_data: 'menu' }],
    ] },
  };
  if (screen === 'help') return {
    text: '<b>How it works</b>\n\nThe monitor looks for new public Claude Pro guest-pass links and sends them here.\n\n<b>Open pass</b> takes you to Claude. A link may already be claimed.\n<b>Source</b> opens the original post.\n<b>Used</b> marks a claimed pass and hides it from recent finds.\n\nUse Settings to change the pace, or Pause to stop searches and alerts. Resume restarts the scheduled checks.\n\nYour PC can be off. Only your Telegram account can change these controls.', reply_markup: menu,
  };
  return {
    text: `<b>Claude Pass Radar</b>\n\n${controls.paused ? '⏸ Monitoring paused' : '🟢 Monitoring on'} · Every ${controls.intervalMinutes} min\n${snapshot.lastScanAt ? `Last checked ${age(snapshot.lastScanAt, now)}` : 'Waiting for the next scheduled scan'}\n\nFresh guest passes, sent here automatically.\nChoose an option below.`, reply_markup: menu,
  };
}
