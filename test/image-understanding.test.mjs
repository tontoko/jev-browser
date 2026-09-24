import assert from 'node:assert/strict';
import { test } from 'node:test';

const screen = () => ({
  observationId: 'screen-fixture-1',
  viewport: { width: 1, height: 1 },
  frames: [{ mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', capturedAt: '2026-09-24T00:00:00.000Z', elapsedMs: 1 }],
  action: { id: 'look-1', kind: 'look', startedAt: '2026-09-24T00:00:00.000Z', durationMs: 1, outcome: 'observed' },
});
const request = () => ({ state: { task: 'Interpret this fixture' }, questions: { visible: { query: 'Is the view legible?', criteria: { yes: 'Legible', unknown: 'Not enough evidence' } } } });

test('image decisions pass only an explicit pixel-derived description to the existing decision engine', async () => {
  const boundary = await import('../dist/image-understanding.js').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof boundary.decideFromScreen, 'function', 'optional image boundary is missing');
  const original = screen();
  let received;
  const result = await boundary.decideFromScreen(original, request(), {
    understand: { describe: async observation => {
      assert.equal(observation.frames[0].data, original.frames[0].data);
      assert.equal(observation.observationId, original.observationId);
      return { text: 'One small white pixel. No readable control; uncertain.', model: 'vision-fixture' };
    } },
    engine: { decide: async value => {
      received = value;
      return { answers: { visible: { choice: 'unknown', confidence: 0.64 } }, model: 'decision-fixture', usage: { input_tokens: 12, output_tokens: 3 } };
    } },
  });
  assert.equal(result.decision.answers.visible.confidence, 0.64);
  assert.deepEqual(received.questions, request().questions);
  assert.equal(received.state.visual.interpretation, 'One small white pixel. No readable control; uncertain.');
  assert.equal(received.state.context.task, 'Interpret this fixture');
  assert.equal(JSON.stringify(received).includes(original.frames[0].data), false);
  assert.equal(result.evidence.observationId, original.observationId);
  assert.equal(result.evidence.coordinateSpace, 'image-pixels');
  assert.equal(result.evidence.freshness, 'snapshot');
  assert.match(result.evidence.frames[0].sha256, /^[a-f0-9]{64}$/);
});

import { createServer } from 'node:http';
import { once } from 'node:events';
import { ChatCompletionsImageUnderstanding, decideFromScreen } from '../dist/image-understanding.js';

async function provider(t, respond = () => ({ choices: [{ message: { content: 'No readable text; location is uncertain.' } }], model: 'fixture-vl', usage: { prompt_tokens: 8, completion_tokens: 5 } })) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    calls.push({ path: req.url, authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) });
    const value = await respond(calls.at(-1), res);
    if (!res.writableEnded && value !== undefined) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { calls, baseURL: `http://127.0.0.1:${server.address().port}/v1/` };
}
const trivialEngine = () => ({ decide: async () => ({ answers: { visible: { choice: 'unknown', confidence: 0.23 } } }) });

test('one vision request carries ordered original PNGs and geometry, not expected answers or local paths', async t => {
  const p = await provider(t);
  const adapter = new ChatCompletionsImageUnderstanding({ baseURL: p.baseURL, model: 'fixture/requested', apiKey: 'vision-test-only' });
  assert.equal(p.calls.length, 0, 'construction must not upload anything');
  const original = screen();
  original.frames[0].path = '/private/fixture-only/capture.png';
  original.frames.push({ ...original.frames[0], capturedAt: '2026-09-24T00:00:00.500Z' });
  const req = request();
  req.state.hiddenOracle = 'oracle-must-not-reach-vision';
  req.questions.second = { query: 'Another independent question', criteria: { unknown: 'Uncertain' } };
  let decisionCalls = 0;
  const result = await decideFromScreen(original, req, { understand: adapter, engine: { decide: async value => {
    decisionCalls++;
    assert.deepEqual(Object.keys(value), ['state', 'questions']);
    assert.equal(value.state.context.hiddenOracle, 'oracle-must-not-reach-vision');
    return { answers: { visible: { choice: 'unknown', confidence: 0.23 }, second: { choice: 'unknown', confidence: 0.31 } }, usage: { input_tokens: 15, output_tokens: 6 } };
  } } });
  assert.equal(p.calls.length, 1); assert.equal(decisionCalls, 1);
  const call = p.calls[0];
  assert.equal(call.path, '/v1/chat/completions');
  assert.equal(call.authorization, 'Bearer vision-test-only');
  assert.equal(call.body.model, 'fixture/requested'); assert.equal(call.body.stream, false);
  const content = call.body.messages[1].content;
  assert.equal(content.filter(item => item.type === 'image_url').length, 2);
  assert.equal(content[1].image_url.url, `data:image/png;base64,${original.frames[0].data}`);
  assert.deepEqual(JSON.parse(content[0].text).frames.map(frame => frame.capturedAt), original.frames.map(frame => frame.capturedAt));
  assert.equal(JSON.stringify(call.body).includes('oracle-must-not-reach-vision'), false);
  assert.equal(JSON.stringify(call.body).includes('/private/fixture-only'), false);
  assert.deepEqual(result.evidence.usage, { input_tokens: 8, output_tokens: 5 });
  assert.deepEqual(result.decision.usage, { input_tokens: 15, output_tokens: 6 });
  assert.equal(result.evidence.requestedModel, 'fixture/requested');
  assert.equal(result.evidence.model, 'fixture-vl');
});

test('an authentication-free explicit endpoint receives no inherited Jev/cloud key', async t => {
  const p = await provider(t);
  const before = process.env.JEV_API_KEY;
  process.env.JEV_API_KEY = 'do-not-inherit-test-only';
  t.after(() => { if (before === undefined) delete process.env.JEV_API_KEY; else process.env.JEV_API_KEY = before; });
  await new ChatCompletionsImageUnderstanding({ baseURL: p.baseURL, model: 'fixture' }).describe(screen());
  assert.equal(p.calls[0].authorization, undefined);
  assert.equal(JSON.stringify(p.calls[0].body).includes('do-not-inherit-test-only'), false);
});

test('failed image conversion stops before Jev and does not retry or expose provider details', async t => {
  const p = await provider(t, (_call, res) => { res.statusCode = 503; return { error: 'private-provider-body' }; });
  let decisions = 0;
  await assert.rejects(decideFromScreen(screen(), request(), {
    understand: new ChatCompletionsImageUnderstanding({ baseURL: p.baseURL, model: 'fixture' }),
    engine: { decide: async () => { decisions++; return {}; } },
  }), error => error.code === 'PROVIDER_ERROR' && /503/.test(error.message) && !/private-provider-body/.test(error.message));
  assert.equal(decisions, 0); assert.equal(p.calls.length, 1);
});

for (const body of [{ choices: [] }, { choices: [{ message: { content: null } }] }, { choices: [{ message: { content: '  ' } }] }]) {
  test(`empty/refused caption is not silently converted to success: ${JSON.stringify(body)}`, async t => {
    const p = await provider(t, () => body);
    let decisions = 0;
    await assert.rejects(decideFromScreen(screen(), request(), {
      understand: new ChatCompletionsImageUnderstanding({ baseURL: p.baseURL, model: 'fixture' }),
      engine: { decide: async () => { decisions++; return {}; } },
    }), { code: 'INVALID_DECISION' });
    assert.equal(decisions, 0);
  });
}

test('missing image configuration refuses before provider work', async () => {
  let calls = 0;
  await assert.rejects(decideFromScreen(screen(), request(), { understand: undefined, engine: { decide: async () => { calls++; return {}; } } }), { code: 'CONFIG' });
  assert.equal(calls, 0);
  for (const config of [{ baseURL: '', model: 'fixture' }, { baseURL: 'file:///tmp/fixture', model: 'fixture' }, { baseURL: 'https://name:pass@example.invalid/v1', model: 'fixture' }, { baseURL: 'http://localhost/v1', model: '' }])
    assert.throws(() => new ChatCompletionsImageUnderstanding(config), { code: 'CONFIG' });
});

test('unsupported image metadata refuses before conversion and is not relabeled as PNG', async () => {
  let calls = 0;
  const original = screen(); original.frames[0].mimeType = 'image/jpeg';
  await assert.rejects(decideFromScreen(original, request(), { understand: { describe: async () => { calls++; return { text: 'bad' }; } }, engine: trivialEngine() }), { code: 'INVALID_ARGUMENT' });
  assert.equal(calls, 0);
});

test('caller/adaptor mutation during conversion cannot alter the observation, questions or evidence identity', async () => {
  const original = screen(), req = request();
  let release;
  const suspended = new Promise(resolve => { release = resolve; });
  const resultPromise = decideFromScreen(original, req, { understand: { describe: async value => {
    value.frames[0].data = 'caller-adapter-mutated';
    value.viewport.width = 900;
    await suspended;
    return { text: 'No readable control.' };
  } }, engine: { decide: async input => {
    assert.equal(input.questions.visible.query, 'Is the view legible?');
    assert.equal(input.state.context.task, 'Interpret this fixture');
    assert.equal(input.state.visual.viewport.width, 1);
    input.state.visual.viewport.width = 800;
    input.state.visual.frames[0].sha256 = 'must-not-rewrite-evidence';
    return { answers: {} };
  } } });
  original.frames[0].data = 'caller-mutated'; original.viewport.width = 700;
  req.questions.visible.query = 'changed'; req.state.task = 'changed';
  release();
  const result = await resultPromise;
  assert.equal(result.evidence.viewport.width, 1);
  assert.match(result.evidence.frames[0].sha256, /^[a-f0-9]{64}$/);
});

test('pre-cancelled and conversion-cancelled requests cannot start a later Jev call', async () => {
  const aborted = AbortSignal.abort(); let captions = 0, decisions = 0;
  const options = { understand: { describe: async () => { captions++; return { text: 'fixture' }; } }, engine: { decide: async () => { decisions++; return {}; } } };
  await assert.rejects(decideFromScreen(screen(), request(), { ...options, signal: aborted }));
  assert.equal(captions, 0); assert.equal(decisions, 0);
  const controller = new AbortController();
  await assert.rejects(decideFromScreen(screen(), request(), { ...options, signal: controller.signal,
    understand: { describe: async () => { controller.abort(); return { text: 'too late' }; } },
  }));
  assert.equal(decisions, 0);
});

test('cancellation after decision does not return a successful result', async () => {
  const controller = new AbortController();
  await assert.rejects(decideFromScreen(screen(), request(), { signal: controller.signal,
    understand: { describe: async () => ({ text: 'fixture' }) },
    engine: { decide: async () => { controller.abort(); return { answers: {} }; } },
  }));
});

test('real HTTP cancellation aborts the caption request without starting Jev', async t => {
  let started;
  const arrived = new Promise(resolve => { started = resolve; });
  const p = await provider(t, () => { started(); return undefined; });
  const controller = new AbortController(); let decisions = 0;
  const pending = decideFromScreen(screen(), request(), { signal: controller.signal,
    understand: new ChatCompletionsImageUnderstanding({ baseURL: p.baseURL, model: 'fixture' }),
    engine: { decide: async () => { decisions++; return {}; } },
  });
  const refused = assert.rejects(pending, { code: 'CANCELLED' });
  await arrived; controller.abort(); await refused;
  assert.equal(decisions, 0); assert.equal(p.calls.length, 1);
});

test('caption HTTP timeout is bounded and has no downstream decision', async t => {
  const p = await provider(t, () => undefined); let decisions = 0;
  await assert.rejects(decideFromScreen(screen(), request(), {
    understand: new ChatCompletionsImageUnderstanding({ baseURL: p.baseURL, model: 'fixture', timeoutMs: 40 }),
    engine: { decide: async () => { decisions++; return {}; } },
  }), { code: 'CANCELLED' });
  assert.equal(decisions, 0);
});

test('a redirect is not followed with captured images or vision credentials', async t => {
  const p = await provider(t, (_call, res) => { res.statusCode = 302; res.setHeader('Location', '/unexpected'); return {}; });
  await assert.rejects(new ChatCompletionsImageUnderstanding({ baseURL: p.baseURL, model: 'fixture', apiKey: 'vision-test-only' }).describe(screen()), { code: 'PROVIDER_ERROR' });
  assert.equal(p.calls.length, 1);
});

test('unknown vision usage remains unknown, not zero-cost evidence', async t => {
  const p = await provider(t, () => ({ choices: [{ message: { content: 'Uncertain' } }] }));
  const result = await new ChatCompletionsImageUnderstanding({ baseURL: p.baseURL, model: 'fixture' }).describe(screen());
  assert.equal(result.usage, undefined); assert.equal(result.model, undefined);
  assert.equal(result.requestedModel, 'fixture');
});

test('an empty decision request is rejected before paying for image conversion', async () => {
  let calls = 0;
  await assert.rejects(decideFromScreen(screen(), { state: {}, questions: {} }, {
    understand: { describe: async () => { calls++; return { text: 'fixture' }; } }, engine: trivialEngine(),
  }), { code: 'INVALID_ARGUMENT' });
  assert.equal(calls, 0);
});

test('extra caller fields on a captured viewport cannot reach the vision provider', async t => {
  const p = await provider(t);
  const original = screen(); original.viewport.hiddenDOM = 'must-not-be-sent';
  await decideFromScreen(original, request(), {
    understand: new ChatCompletionsImageUnderstanding({ baseURL: p.baseURL, model: 'fixture' }), engine: trivialEngine(),
  });
  assert.equal(JSON.stringify(p.calls[0].body).includes('must-not-be-sent'), false);
});
