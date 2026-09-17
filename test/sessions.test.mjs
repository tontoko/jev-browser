import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, readdir, lstat, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { httpServer } from './helpers.mjs';
let service, cwd;
before(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'jev-session-test-'));
  service = await httpServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<h1>Pending</h1><label>Name<input></label><button onclick="document.querySelector('h1').textContent=document.querySelector('input').value">Save</button>`); });
});
after(async () => { await service?.close(); await rm(cwd, { recursive: true, force: true }); });
const cliFile = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
async function cli(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliFile, ...args], { cwd, env: { ...process.env, JEV_API_KEY: '', TYPESAFE_API_KEY: '', JEV_SESSION_DIR: join(cwd, 'sessions') }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c);
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI session command timed out')); }, 18000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); }); child.stdin.end(input);
  });
}
test('independent CLI invocations share a named browser and native refs without any model key', async t => {
  const session = 'test-' + randomUUID().slice(0, 8);
  t.after(() => cli(['close', '--session', session]));
  const opened = await cli(['open', service.url, '--session', session]); assert.equal(opened.code, 0, opened.stdout + opened.stderr);
  const snapshot = await cli(['snapshot', '--session', session]); assert.equal(snapshot.code, 0, snapshot.stdout);
  const data = JSON.parse(snapshot.stdout).result;
  const field = data.elements.find(e => e.name === 'Name'); assert.ok(field);
  const filled = await cli(['fill', field.id, 'Teacher', '--session', session]); assert.equal(filled.code, 0, filled.stdout);
  const clicked = await cli(['click', 'button', '--session', session]); assert.equal(clicked.code, 0, clicked.stdout);
  const checked = await cli(['assert', '--args', JSON.stringify({ target: 'h1', property: 'text', expected: 'Teacher' }), '--session', session]);
  assert.equal(checked.code, 0, checked.stdout); assert.equal(JSON.parse(checked.stdout).result.reason, 'verified');
  const wrong = await cli(['assert', '--args', JSON.stringify({ target: 'h1', property: 'text', expected: 'Wrong' }), '--session', session]); assert.equal(wrong.code, 1);
  const sessions = await cli(['sessions']); assert.ok(JSON.parse(sessions.stdout).result.sessions.some(s => s.name === session));
  const closed = await cli(['close', '--session', session]); assert.equal(closed.code, 0, closed.stdout);
  const gone = await cli(['snapshot', '--session', session]); assert.equal(gone.code, 1);
});
test('session endpoints reject requests without the private authentication token', async t => {
  const session = 'auth-' + randomUUID().slice(0, 8); t.after(() => cli(['close', '--session', session]));
  const open = await cli(['open', service.url, '--session', session]); assert.equal(open.code, 0, open.stdout);
  const directories = await readdir(join(cwd, 'sessions'));
  let descriptor, file;
  for (const directory of directories) {
    try { const path = join(cwd, 'sessions', directory, 'session.json'); const value = JSON.parse(await readFile(path, 'utf8')); if (value.name === session) { descriptor = value; file = path; } } catch {}
  }
  assert.ok(descriptor); assert.ok(!open.stdout.includes(descriptor.token));
  if (process.platform !== 'win32') assert.equal((await lstat(file)).mode & 0o077, 0);
  const denied = await fetch(`http://127.0.0.1:${descriptor.port}/command`, { method: 'POST', body: JSON.stringify({ command: 'snapshot' }) }); assert.equal(denied.status, 401);
  const crossOrigin = await fetch(`http://127.0.0.1:${descriptor.port}/command`, { method: 'POST', headers: { authorization: `Bearer ${descriptor.token}`, origin: 'https://attacker.invalid' }, body: JSON.stringify({ command: 'snapshot' }) }); assert.equal(crossOrigin.status, 403);
});
test('invalid session names cannot become filesystem paths', async () => {
  const r = await cli(['open', service.url, '--session', '../escape']); assert.equal(r.code, 1); assert.match(r.stdout, /INVALID_ARGUMENT/);
});
test('a one-shot native command uses shared dispatch and supports JSON arguments', async () => {
  const r = await cli(['assert', '--url', service.url, '--args', JSON.stringify({ target: 'h1', property: 'text', expected: 'Pending' })]);
  assert.equal(r.code, 0, r.stdout); assert.equal(JSON.parse(r.stdout).result.reason, 'verified');
});

test('open recovers an owned descriptor only after its worker process is proven dead', async t => {
  const name = 'recover-' + randomUUID().slice(0, 8); t.after(() => cli(['close', '--session', name]));
  const opened = await cli(['open', service.url, '--session', name]); assert.equal(opened.code, 0, opened.stdout);
  const root = join(cwd, 'sessions'); let directory, descriptor;
  for (const entry of await readdir(root)) {
    try { const data = JSON.parse(await readFile(join(root, entry, 'session.json'), 'utf8')); if (data.name === name) { directory = join(root, entry); descriptor = data; } } catch {}
  }
  assert.ok(descriptor);
  const closed = await cli(['close', '--session', name]); assert.equal(closed.code, 0, closed.stdout);
  const pid = await new Promise((resolve, reject) => { const p = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' }); p.once('error', reject); p.once('close', () => resolve(p.pid)); });
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, 'session.json'), JSON.stringify({ ...descriptor, pid }), { mode: 0o600, flag: 'wx' });
  const recovered = await cli(['open', service.url, '--session', name]); assert.equal(recovered.code, 0, recovered.stdout + recovered.stderr);
  assert.equal(JSON.parse(recovered.stdout).result.reused, false);
});
