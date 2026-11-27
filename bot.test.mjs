import test from 'node:test';
import assert from 'node:assert/strict';
import { handleUpdate } from './bot-handler.mjs';
import { defaultControls } from './bot-storage.mjs';
import { renderScreen, passCard } from './bot-ui.mjs';
import { hasWebhookSecret } from './api/webhook.mjs';

function fixture() {
  let controls = structuredClone(defaultControls);
  const messages = [];
  const calls = [];
  return {
    messages, calls, controls: () => controls,
    services: {
      owner: '123',
      readControls: async () => controls,
      updateControls: async change => { controls = change(structuredClone(controls)) || controls; return controls; },
      readSnapshot: async () => ({ recent: [], sources: { available: ['X'], unavailable: ['Reddit'] } }),
      telegramApi: async (method, payload) => { calls.push({ method, payload }); },
      sendTelegram: async (text, options) => { messages.push({ text, options }); },
    },
  };
}

const message = (id, text, owner = 123) => ({ update_id: id, message: { chat: { id: owner }, from: { id: owner }, text } });

test('only the owner can change monitoring settings', async () => {
  const app = fixture();
  assert.deepEqual(await handleUpdate(message(1, '/pause', 999), app.services), { ignored: true });
  assert.equal(app.controls().paused, false);
  assert.equal(app.messages.length, 0);
});

test('pause and resume persist immediately and duplicate updates are ignored', async () => {
  const app = fixture();
  await handleUpdate(message(1, '/pause'), app.services);
  assert.equal(app.controls().paused, true);
  await handleUpdate(message(1, '/pause'), app.services);
  assert.equal(app.messages.length, 1);
  await handleUpdate(message(2, '/resume'), app.services);
  assert.equal(app.controls().paused, false);
});

test('inline settings controls acknowledge taps and change the saved interval', async () => {
  const app = fixture();
  await handleUpdate({ update_id: 1, callback_query: { id: 'query', from: { id: 123 }, message: { chat: { id: 123 }, message_id: 99 }, data: 'interval:60' } }, app.services);
  assert.equal(app.controls().intervalMinutes, 60);
  assert.equal(app.calls[0].method, 'answerCallbackQuery');
  assert.equal(app.calls[1].method, 'editMessageText');
});

test('Telegram delivery failures can be retried without losing the control response', async () => {
  const app = fixture();
  app.services.sendTelegram = async () => { throw new Error('Delivery failed'); };
  await assert.rejects(handleUpdate(message(1, '/pause'), app.services));
  assert.equal(app.controls().lastUpdateId, -1);
  assert.equal(app.controls().paused, true);
  app.services.sendTelegram = async text => app.messages.push({ text });
  await handleUpdate(message(1, '/pause'), app.services);
  assert.equal(app.messages.length, 1);
});

test('Used marks only one pass and preserves other buttons in a batch', async () => {
  const app = fixture();
  const passes = [0, 1].map(index => ({ hash: String(index).repeat(32), url: `https://claude.ai/referral/passCode${index}`, source: 'https://x.com/user/status/1', published: new Date().toISOString(), messageId: 22, batchIndex: index }));
  app.services.readSnapshot = async () => ({ recent: passes });
  await handleUpdate({ update_id: 1, callback_query: { id: 'query', from: { id: 123 }, message: { chat: { id: 123 }, message_id: 22 }, data: `used:${passes[0].hash}` } }, app.services);
  const keyboard = app.calls.find(call => call.method === 'editMessageReplyMarkup').payload.reply_markup.inline_keyboard;
  assert.equal(keyboard[0][0].callback_data, 'noop');
  assert.equal(keyboard[1][0].url, passes[1].url);
});

test('menus are short, callback payloads fit Telegram limits, and source text is escaped', () => {
  const controls = structuredClone(defaultControls);
  for (const screen of ['menu', 'status', 'sources', 'budget', 'settings', 'help', 'latest']) {
    const card = renderScreen(screen, controls, { recent: [], sources: { available: ['<script>'], unavailable: [] } });
    assert.ok(card.text.length < 4096);
    assert.ok(!card.text.includes('<script>'));
  }
  const card = passCard([{ hash: 'a'.repeat(32), source: 'https://x.com/user/status/1', url: 'https://claude.ai/referral/freshCode1', published: new Date().toISOString() }]);
  for (const button of card.reply_markup.inline_keyboard.flat()) {
    if (button.callback_data) assert.ok(Buffer.byteLength(button.callback_data) <= 64);
  }
});

test('the webhook rejects missing or incorrect secrets', () => {
  assert.equal(hasWebhookSecret(undefined, 'secret'), false);
  assert.equal(hasWebhookSecret('wrong', 'secret'), false);
  assert.equal(hasWebhookSecret('secret', 'secret'), true);
});

test('Recent finds excludes expired passes and displays the newest pass first in seconds', () => {
  const now = Date.parse('2026-11-18T10:00:00Z');
  const recent = [1_200_001, 1_200_000, 25_000].map((age, index) => ({
    hash: String(index).repeat(32),
    source: 'https://x.com/user/status/1',
    url: `https://claude.ai/referral/passCode${index}`,
    published: new Date(now - age).toISOString(),
  }));
  const card = renderScreen('latest', defaultControls, { recent }, now);
  assert.match(card.text, /25 sec ago[\s\S]*20 min ago/);
  assert.deepEqual(card.reply_markup.inline_keyboard.slice(0, -1).map(row => row[0].url),
    [recent[2].url, recent[1].url]);
  assert.match(renderScreen('latest', defaultControls, { recent: [recent[0]] }, now).text, /No passes from the last 20 minutes/);
});
