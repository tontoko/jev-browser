import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JevBrowser, SystemOneScreenJudge, judgeFromScreen } from '../dist/index.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=';
const screen = () => ({ observationId: 'obs-1', viewport: { width: 1, height: 1 }, navigated: false,
  frames: [{ mimeType: 'image/png', data: png, capturedAt: '2026-01-01T00:00:00.000Z', elapsedMs: 1 }],
  action: { id: 'look-1', kind: 'look', startedAt: '2026-01-01T00:00:00.000Z', durationMs: 1, outcome: 'observed' } });
const recorder = (answers, { envelope = true, status = 200 } = {}) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const inner = { answers, model: 'fixture-omni', usage: { input_tokens: 42, output_tokens: 0 } };
    return new Response(JSON.stringify(envelope ? { success: true, result: inner } : inner), { status });
  };
  return { calls, fetch };
};
const runUrl = 'https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/vendor/vision-judge';

test('all items go in one request with the image and page content; per-item probabilities and default threshold 0.5', async () => {
  const { calls, fetch } = recorder({ primary_color: { type: 'noul', noul: 0.97 }, can_add_item: { type: 'noul', noul: 0.12 } });
  const judge = new SystemOneScreenJudge({ baseURL: runUrl, apiKey: 'test-only', fetch });
  const result = await judgeFromScreen(screen(), { state: { spec: 'Primary color is blue #0055ff' },
    items: { primary_color: 'Is the primary button blue (#0055ff)?', can_add_item: 'Can the user add an item from this screen?' } },
    { judge, page: { kind: 'text', content: 'Items\nAdd item' } });
  assert.equal(calls.length, 1);
  const { url, headers, body } = calls[0];
  assert.equal(url, runUrl); assert.equal(headers.authorization, 'Bearer test-only');
  assert.equal(body.model, 'vision-judge');
  assert.deepEqual(body.images, [`data:image/png;base64,${png}`]);
  assert.deepEqual(Object.keys(body.questions), ['primary_color', 'can_add_item']);
  assert.equal(body.questions.primary_color.type, 'noul');
  assert.equal(body.state.page.text, 'Items\nAdd item');
  assert.equal(body.state.spec, 'Primary color is blue #0055ff');
  assert.equal(result.passed, false); assert.deepEqual(result.failed, ['can_add_item']);
  assert.deepEqual(result.items.primary_color, { probability: 0.97, threshold: 0.5, passed: true });
  assert.equal(result.usage.input_tokens, 42); assert.equal(result.model, 'fixture-omni');
  assert.match(result.evidence.frames[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.evidence.page, 'text');
});

test('thresholds: configured default, request override and per-item override', async () => {
  const { fetch } = recorder({ a: { noul: 0.6 }, b: { noul: 0.6 } }, { envelope: false });
  const judge = new SystemOneScreenJudge({ baseURL: 'http://127.0.0.1:9/', model: 'm', threshold: 0.7, fetch });
  let r = await judgeFromScreen(screen(), { items: { a: 'A?', b: { instructions: 'B?', threshold: 0.55 } } }, { judge });
  assert.deepEqual(r.failed, ['a']);
  r = await judgeFromScreen(screen(), { threshold: 0.5, items: { a: 'A?', b: 'B?' } }, { judge });
  assert.equal(r.passed, true);
});

test('System One API root gets /v1/systemone; no page content when page is none', async () => {
  const { calls, fetch } = recorder({ a: { noul: 0.9 } }, { envelope: false });
  const judge = new SystemOneScreenJudge({ baseURL: 'http://localhost:8000', model: 'local-judge', fetch });
  await judgeFromScreen(screen(), { items: { a: 'A?' } }, { judge });
  assert.equal(calls[0].url, 'http://localhost:8000/v1/systemone');
  assert.equal('page' in calls[0].body.state, false);
  assert.equal(calls[0].headers.authorization, undefined);
});

test('configuration and request validation', async () => {
  assert.throws(() => new SystemOneScreenJudge({ baseURL: 'http://example.com/', model: 'm' }), /HTTPS/);
  assert.throws(() => new SystemOneScreenJudge({ baseURL: 'https://example.com/' }), /needs model/);
  assert.throws(() => new SystemOneScreenJudge({ baseURL: runUrl }), /API token/);
  assert.throws(() => new SystemOneScreenJudge({ baseURL: runUrl, apiKey: 'k', threshold: 2 }), /0 to 1/);
  const judge = new SystemOneScreenJudge({ baseURL: runUrl, apiKey: 'k', fetch: recorder({}).fetch });
  const many = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`i${i}`, 'Q?']));
  await assert.rejects(judgeFromScreen(screen(), { items: many }, { judge }), /1 to 64/);
  await assert.rejects(judgeFromScreen(screen(), { items: { 'bad id': 'Q?' } }, { judge }), /Item id/);
  await assert.rejects(judgeFromScreen(screen(), { items: { a: 'Q?' } }, { judge }), /no probability for item a/);
});

test('provider errors are reported, including success:false envelopes', async () => {
  const judge = new SystemOneScreenJudge({ baseURL: runUrl, apiKey: 'k', fetch: async () => new Response(JSON.stringify({ success: false, errors: [] }), { status: 200 }) });
  await assert.rejects(judgeFromScreen(screen(), { items: { a: 'Q?' } }, { judge }), /PROVIDER_ERROR|returned HTTP/);
});

test('JevBrowser.screenJudge captures a real viewport and page text in one judge call; text-only engine untouched', async t => {
  const calls = [];
  const browser = await JevBrowser.launch({ contextOptions: { viewport: { width: 320, height: 200 } },
    judge: { judge: async input => { calls.push(input); return { probabilities: { add: 0.9, color: 0.2 }, model: 'adapter' }; } } });
  t.after(() => browser.close());
  assert.equal(browser.hasJudge, true);
  await browser.page.setContent('<h1>Items</h1><button style="background:#0055ff;color:#fff">Add item</button>');
  const r = await browser.screenJudge({ items: { add: 'Can the user add an item?', color: 'Is the button red?' } });
  assert.equal(calls.length, 1);
  assert.match(calls[0].state.page.text, /Add item/);
  const bytes = Buffer.from(calls[0].images[0].data, 'base64');
  assert.equal(bytes.readUInt32BE(16), 320);
  assert.deepEqual(r.failed, ['color']);
  const html = await browser.screenJudge({ page: 'html', items: { add: 'Q?', color: 'Q?' } });
  assert.match(calls[1].state.page.html, /<button/); assert.equal(html.evidence.page, 'html');
});

test('screenJudge without a judge is a CONFIG error', async t => {
  const browser = await JevBrowser.launch();
  t.after(() => browser.close());
  assert.equal(browser.hasJudge, false);
  await assert.rejects(browser.screenJudge({ items: { a: 'Q?' } }), /needs a judge endpoint/);
});
