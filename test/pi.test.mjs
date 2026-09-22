import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const html = `<!doctype html><title>Unshared title</title>
<style>body{margin:0;background:#fff}input,button{position:fixed;box-sizing:border-box}
input{left:20px;top:20px;width:220px;height:40px}button{left:20px;top:90px;width:120px;height:40px}</style>
<div hidden>UNSHARED_DOM_SENTINEL</div><input aria-label="Name"><button>Save</button>
<script>document.querySelector('button').onclick=()=>{
fetch('/save',{method:'POST',body:document.querySelector('input').value});
document.body.style.background='#008844';};</script>`;

async function fixture(t) {
  const state = { visits: 0, saves: [], failNavigation: false };
  const server = createServer(async (req, res) => {
    if (req.url === '/save') {
      let text = '';
      for await (const part of req) text += part;
      state.saves.push(text);
      res.end('saved');
    } else if (req.url === '/') {
      state.visits++;
      if (state.failNavigation) return req.socket.destroy();
      res.setHeader('content-type', 'text/html');
      res.end(html);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return { state, url: `http://127.0.0.1:${server.address().port}/` };
}

async function setup(t, url, extraOptions = {}) {
  let extension;
  await assert.doesNotReject(async () => {
    extension = (await import('../dist/pi.js')).default;
  }, 'the Pi extension must be loadable without a Pi runtime dependency');
  const directory = await mkdtemp(join(tmpdir(), 'jev-pi-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const optionsPath = join(directory, 'options.json');
  await writeFile(optionsPath, JSON.stringify({
    contextOptions: { viewport: { width: 640, height: 480 }, reducedMotion: 'no-preference' },
    ...extraOptions,
  }));
  const tools = new Map();
  const handlers = new Map();
  const previous = { url: process.env.JEV_SCREEN_URL, options: process.env.JEV_SCREEN_OPTIONS };
  process.env.JEV_SCREEN_URL = url;
  process.env.JEV_SCREEN_OPTIONS = optionsPath;
  try {
    extension({
      registerTool(tool) { assert(!tools.has(tool.name)); tools.set(tool.name, tool); },
      on(event, handler) { handlers.set(event, handler); },
    });
  } finally {
    for (const [name, value] of [['JEV_SCREEN_URL', previous.url], ['JEV_SCREEN_OPTIONS', previous.options]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  const shutdown = async () => handlers.get('session_shutdown')?.();
  t.after(shutdown);
  return {
    tools, handlers, shutdown, optionsPath,
    screen: (input, signal) => tools.get('browser_screen').execute('screen-call', input, signal),
    close: (input = {}) => tools.get('browser_close').execute('close-call', input),
  };
}

function observation(result) {
  const metadata = JSON.parse(result.content.find(item => item.type === 'text').text);
  const images = result.content.filter(item => item.type === 'image');
  assert.equal(images.length, metadata.frames.length);
  for (const image of images) {
    assert.equal(image.mimeType, 'image/png');
    assert.equal(Buffer.from(image.data, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert(!JSON.stringify(metadata).includes(image.data), 'metadata must not repeat image bytes');
    assert(!JSON.stringify(result.details).includes(image.data), 'details must not repeat image bytes');
  }
  assert.deepEqual(Object.keys(metadata).sort(), ['action', 'frames', 'observationId', 'viewport']);
  for (const frame of metadata.frames) {
    assert.deepEqual(Object.keys(frame).sort(), ['capturedAt', 'elapsedMs', 'index', 'mimeType']);
  }
  assert.doesNotMatch(JSON.stringify(metadata), /UNSHARED_DOM_SENTINEL|Unshared title|127\.0\.0\.1|options\.json/);
  return { metadata, images };
}

test('Pi registers only visual tools, launches lazily, and freezes trusted configuration', async t => {
  const { state, url } = await fixture(t);
  const adapter = await setup(t, url);
  assert.deepEqual([...adapter.tools.keys()].sort(), ['browser_close', 'browser_screen']);
  assert.equal(state.visits, 0);
  await writeFile(adapter.optionsPath, JSON.stringify({ contextOptions: { viewport: { width: 999, height: 777 } } }));
  const { metadata, images } = observation(await adapter.screen({ action: 'look' }));
  assert.equal(state.visits, 1);
  assert.deepEqual(metadata.viewport, { width: 640, height: 480 });
  assert.equal(Buffer.from(images[0].data, 'base64').readUInt32BE(16), 640);
  assert.equal(Buffer.from(images[0].data, 'base64').readUInt32BE(20), 480);
  assert.equal(metadata.action.kind, 'look');
  assert.equal(metadata.action.outcome, 'observed');
  assert.equal(adapter.tools.get('browser_screen').executionMode, 'sequential');
  assert.equal(adapter.tools.get('browser_close').executionMode, 'sequential');
});

test('Pi rejects source and configuration arguments before launching a browser', async t => {
  const { state, url } = await fixture(t);
  const adapter = await setup(t, url);
  for (const input of [
    { action: 'look', url },
    { action: 'look', selector: 'body' },
    { action: 'look', command: 'evaluate', expression: 'document.body.innerText' },
    { action: 'look', capture: { frames: 11, intervalMs: 20 } },
    { action: 'click', x: 50, y: 40 },
  ]) await assert.rejects(adapter.screen(input), /INVALID_ARGUMENT/);
  await assert.rejects(adapter.close({ outputDir: '/tmp' }), /INVALID_ARGUMENT/);
  assert.equal(state.visits, 0);
});

test('Pi snapshots the browser engine before the actor starts', async t => {
  const { url } = await fixture(t);
  const previous = process.env.JEV_BROWSER;
  process.env.JEV_BROWSER = 'chromium';
  try {
    const adapter = await setup(t, url);
    process.env.JEV_BROWSER = 'changed-after-registration';
    observation(await adapter.screen({ action: 'look' }));
  } finally {
    if (previous === undefined) delete process.env.JEV_BROWSER;
    else process.env.JEV_BROWSER = previous;
  }
});

test('Pi exposes actual images while keeping saved artifact paths outside actor results', async t => {
  const { url } = await fixture(t);
  const outputDir = await mkdtemp(join(tmpdir(), 'jev-pi-artifacts-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const adapter = await setup(t, url, { outputDir });
  const result = await adapter.screen({ action: 'look' });
  observation(result);
  assert(!JSON.stringify(result).includes(outputDir));
  const names = await readdir(outputDir);
  assert(names.some(name => name.endsWith('.png')), 'the core should save a real image artifact');
  assert(names.some(name => name.endsWith('.jsonl')), 'the outer caller should retain the action journal');
});

test('Pi uses one persistent browser for coordinate input and emits ordered real image frames', async t => {
  const { state, url } = await fixture(t);
  const adapter = await setup(t, url);
  const initial = observation(await adapter.screen({ action: 'look' })).metadata;
  const focused = observation(await adapter.screen({ action: 'click', x: 50, y: 40, observationId: initial.observationId })).metadata;
  await assert.rejects(adapter.screen({ action: 'type', text: 'stale input', observationId: initial.observationId }), /STALE_SCREEN/);
  const fresh = observation(await adapter.screen({ action: 'look' })).metadata;
  const typed = observation(await adapter.screen({ action: 'type', text: 'real viewport input', observationId: fresh.observationId })).metadata;
  const saved = observation(await adapter.screen({ action: 'click', x: 60, y: 110, observationId: typed.observationId }));
  assert.equal(saved.metadata.action.outcome, 'executed');
  const burst = observation(await adapter.screen({ action: 'look', capture: { frames: 3, intervalMs: 30 } }));
  assert.equal(burst.images.length, 3);
  assert.deepEqual(burst.metadata.frames.map(frame => frame.index), [0, 1, 2]);
  assert(burst.metadata.frames[1].elapsedMs >= burst.metadata.frames[0].elapsedMs);
  assert(burst.metadata.frames[2].elapsedMs >= burst.metadata.frames[1].elapsedMs);
  assert.deepEqual(state.saves, ['real viewport input']);
  assert.equal(state.visits, 1, 'actions must preserve the original browser session');
});

test('Pi cancellation prevents an action and shutdown closes the same session without relaunch', async t => {
  const { state, url } = await fixture(t);
  const adapter = await setup(t, url);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(adapter.screen({ action: 'look' }, controller.signal), /cancel|abort/i);
  assert.equal(state.visits, 0);
  const initial = observation(await adapter.screen({ action: 'look' })).metadata;
  const duringWait = new AbortController();
  const waiting = adapter.screen({ action: 'wait', milliseconds: 10000, observationId: initial.observationId }, duringWait.signal);
  setTimeout(() => duringWait.abort(), 30);
  await assert.rejects(waiting, /SCREEN_|cancel|abort/i);
  observation(await adapter.screen({ action: 'look' }));
  await adapter.shutdown();
  await adapter.shutdown();
  const closed = await adapter.close();
  assert.deepEqual(JSON.parse(closed.content[0].text), { status: 'closed' });
  await assert.rejects(adapter.screen({ action: 'look' }), /SCREEN_SESSION_CLOSED/);
  assert.equal(state.visits, 1);
});

test('Pi keeps a failed startup failed and does not disclose navigation details or relaunch', async t => {
  const { state, url } = await fixture(t);
  state.failNavigation = true;
  const adapter = await setup(t, url);
  await assert.rejects(adapter.screen({ action: 'look' }), error => {
    assert.match(error.message, /SCREEN_START_FAILED/);
    assert(!error.message.includes(url));
    return true;
  });
  const visits = state.visits;
  state.failNavigation = false;
  await assert.rejects(adapter.screen({ action: 'look' }), /SCREEN_START_FAILED/);
  assert.equal(state.visits, visits);
});

test('Pi explicit close before first observation stays closed without starting a browser', async t => {
  const { state, url } = await fixture(t);
  const adapter = await setup(t, url);
  await adapter.close();
  await adapter.close();
  await assert.rejects(adapter.screen({ action: 'look' }), /SCREEN_SESSION_CLOSED/);
  assert.equal(state.visits, 0);
});

test('Pi shutdown closes a browser while its initial navigation is still waiting', async t => {
  let response;
  let arrived;
  const requested = new Promise(resolve => { arrived = resolve; });
  const server = createServer((_req, res) => { response = res; arrived(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    response?.end(html);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const adapter = await setup(t, `http://127.0.0.1:${server.address().port}/`);
  const looking = assert.rejects(adapter.screen({ action: 'look' }), /cancel|abort|SCREEN_START_FAILED/i);
  await requested;
  const shutdown = adapter.shutdown();
  let timer;
  const closedWithoutResponse = await Promise.race([
    shutdown.then(() => true),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), 1500); }),
  ]);
  clearTimeout(timer);
  // Release the fixture even on the regression path, so a failed check cannot
  // leave a browser process waiting until Playwright's navigation timeout.
  response.end(html);
  await shutdown;
  await looking;
  assert.equal(closedWithoutResponse, true, 'shutdown must close the owned browser before navigation finishes');
});

test('installed Pi loads the adapter and validates its shared JSON schema', { skip: !process.env.JEV_PI_PACKAGE }, async t => {
  const piRoot = resolve(process.env.JEV_PI_PACKAGE);
  const { loadExtensions } = await import(pathToFileURL(join(piRoot, 'dist/core/extensions/loader.js')));
  const { validateToolArguments } = await import(pathToFileURL(join(piRoot, 'node_modules/@earendil-works/pi-ai/dist/utils/validation.js')));
  const { url } = await fixture(t);
  const previous = process.env.JEV_SCREEN_URL;
  process.env.JEV_SCREEN_URL = url;
  let loaded;
  try {
    loaded = await loadExtensions([resolve('dist/pi.js')], process.cwd());
  } finally {
    if (previous === undefined) delete process.env.JEV_SCREEN_URL;
    else process.env.JEV_SCREEN_URL = previous;
  }
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const extension = loaded.extensions[0];
  t.after(async () => {
    for (const handler of extension.handlers.get('session_shutdown') ?? []) await handler({ type: 'session_shutdown' });
  });
  assert.deepEqual([...extension.tools.keys()].sort(), ['browser_close', 'browser_screen']);
  const tool = extension.tools.get('browser_screen').definition;
  const look = validateToolArguments(tool, { id: 'native-look', name: 'browser_screen', arguments: { action: 'look' } });
  assert.deepEqual(look, { action: 'look' });
  assert.throws(() => validateToolArguments(tool, { id: 'native-invalid', name: 'browser_screen', arguments: { action: 'look', selector: 'body' } }));
  assert.throws(() => validateToolArguments(tool, { id: 'native-empty', name: 'browser_screen', arguments: {} }));
  const incomplete = validateToolArguments(tool, { id: 'native-incomplete', name: 'browser_screen', arguments: { action: 'click', x: 10, y: 20 } });
  await assert.rejects(tool.execute('native-incomplete', incomplete), /INVALID_ARGUMENT/);
  observation(await tool.execute('native-look', look));
});
