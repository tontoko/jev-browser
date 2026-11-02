import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { parseCLI } from '../dist/cli-options.js';
import { createMcpServer } from '../dist/mcp.js';
import { httpServer } from './helpers.mjs';

const cliFile = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const gated = ['browser_cookies', 'browser_evaluate', 'browser_init_script', 'browser_route', 'browser_storage', 'browser_storage_state', 'browser_trace'];
const defaults = ['browser_console_messages', 'browser_downloads', 'browser_file_upload', 'browser_network_requests', 'browser_pdf', 'browser_screenshot', 'browser_take_screenshot'];
let service, cwd;
before(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'jev-caps-test-'));
  await writeFile(join(cwd, 'upload.txt'), 'upload content');
  service = await httpServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<h1>Caps</h1><input type=file>'); });
});
after(async () => { await service?.close(); await rm(cwd, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 }); });
async function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliFile, ...args], { cwd, env: { ...process.env, JEV_API_KEY: '', TYPESAFE_API_KEY: '', JEV_SESSION_DIR: join(cwd, 'sessions') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c);
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI command timed out')); }, 18000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, output: (() => { try { return JSON.parse(stdout); } catch { return undefined; } })() }); });
  });
}
async function toolNames(t, options) {
  const server = createMcpServer(async () => { throw new Error('Unexpected browser startup'); }, options);
  const client = new Client({ name: 'caps', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(st); await client.connect(ct);
  return (await client.listTools()).tools.map(tool => tool.name);
}

test('--caps parses a comma-separated capability list and --allow-evaluate is an alias for evaluate', () => {
  assert.deepEqual(parseCLI(['mcp']).capabilities, []);
  assert.deepEqual(parseCLI(['mcp', '--caps', 'storage,network']).capabilities, ['network', 'storage']);
  assert.deepEqual(parseCLI(['mcp', '--caps', 'trace', '--caps', 'storage']).capabilities, ['storage', 'trace']);
  assert.notEqual(parseCLI(['mcp']).options.allowEvaluate, true);
  for (const argv of [['mcp', '--caps', 'evaluate'], ['mcp', '--allow-evaluate']]) {
    const parsed = parseCLI(argv);
    assert.deepEqual(parsed.capabilities, ['evaluate']); assert.equal(parsed.options.allowEvaluate, true);
  }
  assert.throws(() => parseCLI(['mcp', '--caps', 'storage,vision']), { code: 'INVALID_ARGUMENT', message: /vision.*storage, network, trace, evaluate/ });
});

test('CLI and MCP grant no upload read root unless --file-root is explicit', () => {
  assert.deepEqual(parseCLI(['mcp']).options.fileRoots, []);
  assert.deepEqual(parseCLI(['mcp', '--file-root', '.']).options.fileRoots, ['.']);
});

test('MCP omits tools whose capability is disabled and keeps default-on tools', async t => {
  const none = await toolNames(t, { capabilities: [] });
  for (const name of gated) assert.ok(!none.includes(name), name);
  for (const name of defaults) assert.ok(none.includes(name), name);
  const storage = await toolNames(t, { capabilities: ['storage'] });
  for (const name of ['browser_cookies', 'browser_storage', 'browser_storage_state']) assert.ok(storage.includes(name), name);
  for (const name of ['browser_route', 'browser_trace', 'browser_evaluate', 'browser_init_script']) assert.ok(!storage.includes(name), name);
  const all = await toolNames(t, { capabilities: ['storage', 'network', 'trace', 'evaluate'] });
  for (const name of gated) assert.ok(all.includes(name), name);
  // A library caller that passes no capabilities keeps every tool, as before.
  const library = await toolNames(t);
  for (const name of gated) assert.ok(library.includes(name), name);
});

test('MCP stdio server lists only enabled capability tools', async t => {
  const list = async args => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/mcp-stdio.js', import.meta.url)), ...args], cwd, env: { ...process.env, JEV_API_KEY: '' }, stderr: 'pipe' });
    const client = new Client({ name: 'caps-stdio', version: '1' });
    t.after(() => client.close());
    await client.connect(transport);
    return (await client.listTools()).tools.map(tool => tool.name);
  };
  const plain = await list([]);
  for (const name of gated) assert.ok(!plain.includes(name), name);
  const evaluate = await list(['--allow-evaluate', '--caps', 'network']);
  for (const name of ['browser_evaluate', 'browser_init_script', 'browser_route']) assert.ok(evaluate.includes(name), name);
  assert.ok(!evaluate.includes('browser_cookies'));
});

test('one-shot CLI refuses a disabled capability with CAPABILITY_DISABLED and runs it when enabled', async () => {
  const denied = await cli(['cookies', '--url', service.url, '--args', '{"action":"list"}']);
  assert.equal(denied.code, 1, denied.stdout + denied.stderr);
  assert.equal(denied.output.error.code, 'CAPABILITY_DISABLED'); assert.match(denied.output.error.message, /--caps storage/);
  const allowed = await cli(['cookies', '--url', service.url, '--args', '{"action":"list"}', '--caps', 'storage']);
  assert.equal(allowed.code, 0, allowed.stdout + allowed.stderr);
  const evaluate = await cli(['evaluate', '() => document.title', '--url', service.url]);
  assert.equal(evaluate.output.error.code, 'CAPABILITY_DISABLED'); assert.match(evaluate.output.error.message, /--caps evaluate/);
});

test('CLI upload without --file-root is denied with guidance; --file-root . restores working-directory uploads', async () => {
  const denied = await cli(['upload', 'input', 'upload.txt', '--url', service.url]);
  assert.equal(denied.code, 1, denied.stdout + denied.stderr);
  assert.equal(denied.output.error.code, 'FILE_ACCESS_DENIED'); assert.match(denied.output.error.message, /--file-root \./);
  const allowed = await cli(['upload', 'input', 'upload.txt', '--url', service.url, '--file-root', '.']);
  assert.equal(allowed.code, 0, allowed.stdout + allowed.stderr);
});

test('named sessions fix capabilities at open and refuse a different set on reuse', async t => {
  const session = 'caps-' + randomUUID().slice(0, 8);
  t.after(() => cli(['close', '--session', session]));
  const opened = await cli(['open', service.url, '--session', session]); assert.equal(opened.code, 0, opened.stdout + opened.stderr);
  const denied = await cli(['storage', '--args', '{"area":"local","action":"get","name":"x"}', '--session', session]);
  assert.equal(denied.output.error.code, 'CAPABILITY_DISABLED', denied.stdout);
  // A later command cannot widen the session's capabilities.
  const widened = await cli(['storage', '--args', '{"area":"local","action":"get","name":"x"}', '--session', session, '--caps', 'storage']);
  assert.equal(widened.output.error.code, 'CAPABILITY_DISABLED', widened.stdout);
  const mismatch = await cli(['open', '--session', session, '--caps', 'storage']);
  assert.equal(mismatch.output.error.code, 'SESSION_MODE_MISMATCH', mismatch.stdout);
  // Capabilities are part of the hashed launch options; the error still names them.
  assert.match(mismatch.output.error.message, /different capabilities \(--caps none\)/);
  const same = await cli(['open', '--session', session]); assert.equal(same.code, 0, same.stdout);
  assert.equal(same.output.result.reused, true);

  const enabled = 'caps-on-' + randomUUID().slice(0, 8);
  t.after(() => cli(['close', '--session', enabled]));
  assert.equal((await cli(['open', service.url, '--session', enabled, '--caps', 'network,storage'])).code, 0);
  const stored = await cli(['storage', '--args', '{"area":"local","action":"get","name":"x"}', '--session', enabled]);
  assert.equal(stored.code, 0, stored.stdout);
  assert.equal((await cli(['open', '--session', enabled, '--caps', 'storage,network'])).output.result.reused, true);
  const narrowed = await cli(['open', '--session', enabled]);
  assert.equal(narrowed.output.error.code, 'SESSION_MODE_MISMATCH'); assert.match(narrowed.output.error.message, /--caps network,storage/);
});

test('a session descriptor without a launch-options hash, written by an older release, is never reused', async t => {
  const session = 'caps-old-' + randomUUID().slice(0, 8);
  t.after(() => cli(['close', '--session', session]));
  assert.equal((await cli(['open', service.url, '--session', session])).code, 0);
  let file;
  for (const directory of await readdir(join(cwd, 'sessions'))) {
    const candidate = join(cwd, 'sessions', directory, 'session.json');
    try { if (JSON.parse(await readFile(candidate, 'utf8')).name === session) file = candidate; } catch {}
  }
  assert.ok(file, 'session descriptor not found');
  const { optionsHash, ...older } = JSON.parse(await readFile(file, 'utf8'));
  assert.match(optionsHash, /^[0-9a-f]{64}$/);
  await writeFile(file, JSON.stringify(older));
  const reopened = await cli(['open', '--session', session]);
  assert.equal(reopened.output.error.code, 'SESSION_MODE_MISMATCH', reopened.stdout);
  assert.match(reopened.output.error.message, /older jev-browser version/);
  // Ordinary commands still reach it, and close still works.
  assert.equal((await cli(['snapshot', '--session', session])).code, 0);
});
