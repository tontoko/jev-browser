import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { parseCLI } from '../dist/cli-options.js';
import { JevBrowser } from '../dist/index.js';
import { httpServer } from './helpers.mjs';
import { chromium } from 'playwright-core';
import { createServer } from 'node:net';

const cliFile = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
// The page reports the context it was given, so tests read emulation results through ordinary snapshots.
const environment = `<p id="environment"></p><script>document.getElementById('environment').textContent=[innerWidth+'x'+innerHeight,
  matchMedia('(prefers-reduced-motion: reduce)').matches?'reduce':'motion',matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light',navigator.language].join(' ');</script>`;
let site, cwd;
before(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'jev-launch-options-'));
  site = await httpServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(environment); });
});
after(async () => { await site?.close(); await rm(cwd, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 }); });
const env = () => ({ ...process.env, JEV_API_KEY: '', TYPESAFE_API_KEY: '', JEV_SESSION_DIR: join(cwd, 'sessions') });
function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliFile, ...args], { cwd, env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c);
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI command timed out')); }, 30000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
async function optionsFile(value) {
  const path = join(cwd, `options-${randomUUID()}.json`);
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
  return path;
}
const reported = result => result.texts.find(text => /^\d+x\d+ /.test(text.text))?.text;
const invalid = (argv, pattern) => assert.throws(() => parseCLI(argv), error => error.code === 'INVALID_ARGUMENT' && pattern.test(error.message), String(argv));

test('context flags become Playwright context options and explicit flags win over an options file', async () => {
  assert.equal(parseCLI(['snapshot']).options.contextOptions, undefined);
  assert.deepEqual(parseCLI(['snapshot', '--viewport', '390x844', '--reduced-motion', '--color-scheme', 'dark', '--locale', 'fr-FR']).options.contextOptions,
    { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', colorScheme: 'dark', locale: 'fr-FR' });
  const file = await optionsFile({
    browser: 'webkit', headless: false, launchOptions: { args: ['--lang=de-DE'] }, storageState: 'file-state.json', userDataDir: 'file-profile',
    contextOptions: { viewport: { width: 500, height: 400 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', isMobile: true, deviceScaleFactor: 2 },
  });
  const merged = parseCLI(['snapshot', '--options-file', file]).options;
  assert.equal(merged.browser, 'webkit', 'an explicit file setting wins over the JEV_BROWSER default');
  assert.equal(merged.headless, false); assert.deepEqual(merged.launchOptions, { args: ['--lang=de-DE'] });
  assert.equal(merged.storageState, 'file-state.json'); assert.equal(merged.userDataDir, 'file-profile');
  const flagged = parseCLI(['snapshot', '--options-file', file, '--browser', 'chromium', '--viewport', '390x844', '--storage-state', 'flag-state.json', '--user-data-dir', 'flag-profile']).options;
  assert.equal(flagged.browser, 'chromium'); assert.equal(flagged.storageState, 'flag-state.json'); assert.equal(flagged.userDataDir, 'flag-profile');
  assert.deepEqual(flagged.contextOptions, { viewport: { width: 390, height: 844 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', isMobile: true, deviceScaleFactor: 2 });
  assert.equal(parseCLI(['snapshot', '--options-file', file, '--headed']).options.headless, false);
  assert.equal(parseCLI(['snapshot', '--options-file', await optionsFile({ contextOptions: { viewport: null } })]).options.contextOptions.viewport, null);
});

test('invalid context flags and options files fail with the offending field', async () => {
  for (const value of ['390', '0x10', '390x', 'x844', '390X844', '1.5x3', '390x844x1']) invalid(['snapshot', '--viewport', value], /^--viewport must be WIDTHxHEIGHT/);
  invalid(['snapshot', '--color-scheme', 'blue'], /^--color-scheme must be light, dark or no-preference\.$/);
  invalid(['snapshot', '--locale', ''], /^--locale must not be empty\.$/);
  invalid(['snapshot', '--options-file', join(cwd, 'missing.json')], /^--options-file could not be read\.$/);
  invalid(['snapshot', '--options-file', await optionsFile('{"contextOptions":')], /^--options-file must contain valid JSON\.$/);
  invalid(['snapshot', '--options-file', await optionsFile([])], /^Invalid --options-file: .*expected object/);
  invalid(['snapshot', '--options-file', await optionsFile({ contextOptions: { viewport: { width: 0, height: 10 } } })], /^Invalid --options-file at contextOptions\.viewport\.width: /);
  invalid(['snapshot', '--options-file', await optionsFile({ contextOptions: { reducedMotion: 'less' } })], /^Invalid --options-file at contextOptions\.reducedMotion: /);
  invalid(['snapshot', '--options-file', await optionsFile({ launchOptions: { args: '--lang=de-DE' } })], /^Invalid --options-file at launchOptions\.args: /);
  invalid(['snapshot', '--options-file', await optionsFile({ browser: 'edge' })], /^Invalid --options-file at browser: /);
  // Only launch and context settings belong in the file; misplaced keys are named, their values are not echoed.
  const misplaced = await optionsFile({ viewport: { width: 390, height: 844 }, apiKey: 'jev-secret-value' });
  assert.throws(() => parseCLI(['snapshot', '--options-file', misplaced]), error => error.code === 'INVALID_ARGUMENT' && /viewport/.test(error.message) && /apiKey/.test(error.message) && !error.message.includes('jev-secret-value'));
  const result = await cli(['snapshot', '--url', site.url, '--viewport', 'wide']);
  assert.equal(result.code, 1); assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_ARGUMENT'); assert.match(JSON.parse(result.stdout).error.message, /--viewport/);
});

test('a one-shot CLI command launches with the requested viewport, motion, color scheme and locale', async () => {
  const result = await cli(['snapshot', '--url', site.url, '--viewport', '390x844', '--reduced-motion', '--color-scheme', 'dark', '--locale', 'fr-FR']);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(reported(JSON.parse(result.stdout).result), '390x844 reduce dark fr-FR');
});

test('a named CLI session keeps the context options it was opened with', async t => {
  const session = 'context-' + randomUUID().slice(0, 8);
  t.after(() => cli(['close', '--session', session]));
  const file = await optionsFile({ contextOptions: { viewport: { width: 500, height: 400 }, locale: 'de-DE' } });
  const opened = await cli(['open', site.url, '--session', session, '--options-file', file, '--viewport', '640x480']);
  assert.equal(opened.code, 0, opened.stdout + opened.stderr);
  const snapshot = await cli(['snapshot', '--session', session]);
  assert.equal(snapshot.code, 0, snapshot.stdout);
  assert.equal(reported(JSON.parse(snapshot.stdout).result), '640x480 motion light de-DE');
});

test('reopening a named CLI session with different launch options is a mode mismatch', async t => {
  const session = 'hash-' + randomUUID().slice(0, 8);
  t.after(() => cli(['close', '--session', session]));
  const opened = await cli(['open', site.url, '--session', session, '--viewport', '640x480']);
  assert.equal(opened.code, 0, opened.stdout + opened.stderr);
  const same = await cli(['open', '--session', session, '--viewport', '640x480']);
  assert.equal(same.code, 0, same.stdout + same.stderr); assert.equal(JSON.parse(same.stdout).result.reused, true);
  for (const flags of [['--viewport', '800x600'], [], ['--locale', 'fr-FR', '--viewport', '640x480'], ['--viewport', '640x480', '--headed']]) {
    const changed = await cli(['open', site.url, '--session', session, ...flags]);
    assert.equal(changed.code, 1, flags.join(' ')); assert.equal(JSON.parse(changed.stdout).error.code, 'SESSION_MODE_MISMATCH', changed.stdout);
  }
  // The existing session is untouched: it keeps its original context.
  const snapshot = await cli(['snapshot', '--session', session]);
  assert.match(reported(JSON.parse(snapshot.stdout).result), /^640x480 /);
});

test('per-call observation flags on session commands do not change the session launch options', async t => {
  const session = 'percall-' + randomUUID().slice(0, 8);
  t.after(() => cli(['close', '--session', session]));
  assert.equal((await cli(['open', site.url, '--session', session])).code, 0);
  const snapshot = await cli(['snapshot', '--session', session, '--max-elements', '300', '--max-texts', '400', '--max-candidates', '500', '--exclude', 'nav']);
  assert.equal(snapshot.code, 0, snapshot.stdout + snapshot.stderr);
  const reopened = await cli(['open', '--session', session]);
  assert.equal(reopened.code, 0, reopened.stdout); assert.equal(JSON.parse(reopened.stdout).result.reused, true);
  // At open the same flags are session defaults, so they are launch options.
  const changed = await cli(['open', '--session', session, '--max-elements', '300']);
  assert.equal(JSON.parse(changed.stdout).error.code, 'SESSION_MODE_MISMATCH', changed.stdout);
});

async function freePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address(); await new Promise(resolve => server.close(resolve)); return port;
}
test('attaching over CDP to an existing context rejects context options instead of ignoring them', async t => {
  if ((process.env.JEV_BROWSER ?? 'chromium') !== 'chromium') { t.skip('CDP requires Chromium'); return; }
  const port = await freePort();
  const remote = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${port}`] });
  t.after(() => remote.close());
  const cdpEndpoint = `http://127.0.0.1:${port}`;
  for (const options of [{ contextOptions: { viewport: { width: 390, height: 844 } } }, { storageState: { cookies: [], origins: [] } }]) {
    await assert.rejects(JevBrowser.launch({ cdpEndpoint, ...options }), error => error.code === 'CONFIG' && /existing browser context/.test(error.message), JSON.stringify(options));
  }
  // Without context options, attaching still borrows the existing context.
  const core = await JevBrowser.launch({ cdpEndpoint });
  await core.close();
  assert.equal(remote.isConnected(), true);
});

test('options-file accepts cdpHeaders and rejects a non-string map', async () => {
  const file = await optionsFile({ cdpEndpoint: 'http://127.0.0.1:9222', cdpHeaders: { Authorization: 'Bearer secret-token-value' } });
  const parsed = parseCLI(['snapshot', '--options-file', file]).options;
  assert.equal(parsed.cdpEndpoint, 'http://127.0.0.1:9222');
  assert.deepEqual(parsed.cdpHeaders, { Authorization: 'Bearer secret-token-value' });
  invalid(['snapshot', '--options-file', await optionsFile({ cdpHeaders: { Authorization: 1 } })], /^Invalid --options-file at cdpHeaders/);
  // Misplaced secret-like keys are named without echoing values.
  const misplaced = await optionsFile({ apiKey: 'jev-secret-value', cdpHeaders: { Authorization: 'Bearer leaked' } });
  assert.throws(() => parseCLI(['snapshot', '--options-file', misplaced]),
    error => error.code === 'INVALID_ARGUMENT' && /apiKey/.test(error.message) && !error.message.includes('jev-secret-value') && !error.message.includes('Bearer leaked'));
});

test('cdpHeaders are required to pass an Authorization gate in front of CDP', async t => {
  if ((process.env.JEV_BROWSER ?? 'chromium') !== 'chromium') { t.skip('CDP requires Chromium'); return; }
  const { createServer: createHttpServer, request: httpRequest } = await import('node:http');
  const port = await freePort();
  const remote = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${port}`] });
  t.after(() => remote.close());
  const token = `Bearer test-${randomUUID()}`;
  let authorizedHits = 0;
  const gate = createHttpServer((req, res) => {
    if (req.headers.authorization !== token) { res.writeHead(401); res.end('unauthorized'); return; }
    authorizedHits += 1;
    const upstream = httpRequest({ hostname: '127.0.0.1', port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, up => {
      res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res);
    });
    upstream.on('error', error => { res.writeHead(502); res.end(String(error)); });
    req.pipe(upstream);
  });
  gate.on('upgrade', (req, socket, head) => {
    if (req.headers.authorization !== token) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    authorizedHits += 1;
    const upstream = httpRequest({ hostname: '127.0.0.1', port, path: req.url, method: 'GET', headers: { ...req.headers, host: `127.0.0.1:${port}`, connection: 'Upgrade', upgrade: 'websocket' } });
    upstream.on('upgrade', (upRes, upSocket, upHead) => {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(upRes.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if (upHead?.length) socket.write(upHead);
      upSocket.pipe(socket); socket.pipe(upSocket);
    });
    upstream.on('error', () => socket.destroy());
    if (head?.length) upstream.write(head);
    upstream.end();
  });
  await new Promise(resolve => gate.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => gate.close(resolve)));
  const gatePort = gate.address().port;
  const cdpEndpoint = `http://127.0.0.1:${gatePort}`;
  await assert.rejects(JevBrowser.launch({ cdpEndpoint }), error => error.code === 'BROWSER_LAUNCH_FAILED' || error.code === 'CONFIG' || /401|Unauthorized|connect/i.test(String(error.message)), 'missing headers must fail');
  const core = await JevBrowser.launch({ cdpEndpoint, cdpHeaders: { Authorization: token } });
  t.after(() => core.close());
  assert.ok(authorizedHits >= 1, `gate saw Authorization (hits=${authorizedHits})`);
  await core.goto(site.url);
  const snap = await core.snapshot();
  assert.equal(snap.url.replace(/\/$/, ''), site.url.replace(/\/$/, ''));
});

test('the MCP stdio server launches its lazy browser with CLI context options', async t => {
  const file = await optionsFile({ contextOptions: { viewport: { width: 414, height: 896 }, colorScheme: 'dark' } });
  const transport = new StdioClientTransport({ command: process.execPath, args: [cliFile, 'mcp', '--options-file', file, '--reduced-motion', '--locale', 'ja-JP', '--url', site.url], cwd, env: env(), stderr: 'pipe' });
  const client = new Client({ name: 'launch-options', version: '1' });
  t.after(() => client.close());
  await client.connect(transport);
  const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: {} });
  assert.notEqual(snapshot.isError, true, JSON.stringify(snapshot.content));
  assert.equal(reported(snapshot.structuredContent), '414x896 reduce dark ja-JP');
});
