import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JevBrowser, JevDecisionEngine, ChatCompletionsImageUnderstanding, decideFromScreen } from '../dist/index.js';

test('real captured viewport flows through vision then the existing System One engine; input still uses the screen authority', async t => {
  const browser = await JevBrowser.launch({ contextOptions: { viewport: { width: 320, height: 200 } } });
  t.after(() => browser.close());
  await browser.page.setContent(`<style>body{margin:0}button{position:absolute;left:20px;top:20px;width:120px;height:50px}</style>
    <button aria-label="hidden-implementation-only-label" onclick="window.saved=(window.saved||0)+1;this.textContent='Saved'">Save</button>`);
  const captured = await browser.screen({ action: 'look' });
  let imageCalls = 0, jevCalls = 0;
  const understand = new ChatCompletionsImageUnderstanding({ baseURL: 'https://vision.invalid/v1', model: 'fixture-vl', fetch: async (url, init) => {
    imageCalls++;
    const body = JSON.parse(init.body), images = body.messages[1].content.filter(item => item.type === 'image_url');
    assert.equal(images.length, 1);
    assert.equal(images[0].image_url.url, `data:image/png;base64,${captured.frames[0].data}`);
    const png = Buffer.from(captured.frames[0].data, 'base64');
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 320); assert.equal(png.readUInt32BE(20), 200);
    assert.equal(init.body.includes('hidden-implementation-only-label'), false);
    // A deterministic model boundary, not a claim of live vision accuracy.
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Visible button labelled Save near (80,45). Its lasting effect is unverified.' } }], model: 'fixture-vl', usage: { prompt_tokens: 20, completion_tokens: 10 } }));
  } });
  const engine = new JevDecisionEngine({ baseURL: 'https://decision.invalid/v1', apiKey: 'test-only', fetch: async (url, init) => {
    jevCalls++;
    const request = new Request(url, init), body = await request.json();
    assert.equal(body.state.visual.interpretation, 'Visible button labelled Save near (80,45). Its lasting effect is unverified.');
    assert.equal(JSON.stringify(body).includes(captured.frames[0].data), false);
    assert.equal(JSON.stringify(body).includes('hidden-implementation-only-label'), false);
    assert.equal('images' in body, false);
    return new Response(JSON.stringify({ answers: { action: { choice: 'save', confidence: 0.61 } }, model: 'fixture-systemone', usage: { input_tokens: 30, output_tokens: 5 } }));
  } });
  const result = await decideFromScreen(captured, { state: { goal: 'Save once' }, questions: { action: { query: 'Which control is visibly labelled for the goal?', criteria: { save: 'Save', unknown: 'Not identifiable from visible evidence' } } } }, { understand, engine });
  assert.equal(imageCalls, 1); assert.equal(jevCalls, 1);
  assert.equal(result.decision.answers.action.confidence, 0.61);
  assert.equal(result.evidence.freshness, 'snapshot');
  // The fixture test supplies coordinates independently; the helper never executes them.
  assert.equal(await browser.page.evaluate(() => window.saved ?? 0), 0);
  await browser.screen({ action: 'click', observationId: captured.observationId, x: 80, y: 45 });
  assert.equal(await browser.page.evaluate(() => window.saved), 1);
  await assert.rejects(browser.screen({ action: 'click', observationId: result.evidence.observationId, x: 80, y: 45 }), { code: 'STALE_SCREEN' });
  assert.equal(await browser.page.evaluate(() => window.saved), 1);
});
