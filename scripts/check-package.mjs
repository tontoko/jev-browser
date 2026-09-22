import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/client';
import { checkInstalledGoal } from './check-installed-goal.mjs';
import { checkInstalledSemantic } from './check-installed-semantic.mjs';
import { checkInstalledResume } from './check-installed-resume.mjs';
import { checkInstalledSelection } from './check-installed-selection.mjs';
import { checkInstalledScreen } from './check-installed-screen.mjs';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = fileURLToPath(new URL('..', import.meta.url));
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run this through npm run check:package.');
async function run(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: ['pipe', 'pipe', 'pipe'], ...options });
    let stdout = '', stderr = '';
    child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c);
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Package verification process timed out')); }, 120000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); if (code !== 0) reject(new Error(`Process failed (${code})\n${stdout}\n${stderr}`)); else resolve({ stdout, stderr }); });
    child.stdin.end();
  });
}
const packed = JSON.parse((await run([npm, 'pack', '--json'])).stdout)[0];
assert.ok(packed.files.some(f => f.path === 'dist/dom.bundle.cjs'));
assert.ok(packed.files.some(f => f.path === 'dist/session-worker.js'));
assert.ok(packed.files.some(f => f.path === 'dist/pi.js'));
assert.ok(packed.files.some(f => f.path === 'dist/pi.d.ts'));
assert.ok(packed.files.some(f => f.path === 'skills/jev-browser/SKILL.md'));
assert.ok(!packed.files.some(f => /(^|\/)(\.env($|\.)|node_modules|artifacts|test-results|\.git)(\/|$)/.test(f.path)));
const tarball = resolve(root, packed.filename);
const directory = await mkdtemp(join(tmpdir(), 'jev-package-consumer-'));
const env = { ...process.env, JEV_API_KEY: '', TYPESAFE_API_KEY: '', JEV_SESSION_DIR: join(directory, 'sessions') };
let site;
try {
  await run([npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: directory, env });
  const pkg = join(directory, 'node_modules', '@tontoko', 'jev-browser');
  const cli = args => run([join(pkg, 'dist', 'cli.js'), ...args], { cwd: directory, env });
  const version = await cli(['--version']); assert.equal(version.stdout.trim(), packed.version);
  if (process.platform !== 'win32') await access(join(directory, 'node_modules', '.bin', 'jev-browser'), constants.X_OK);
  await run(['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { chromium } from 'playwright';
    import { expect } from 'playwright/test';
    import { JevBrowser } from '@tontoko/jev-browser';
    import piExtension from '@tontoko/jev-browser/pi';
    import { z } from 'zod';
    assert.equal(typeof piExtension, 'function');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const engine = { async decide(request) {
      const answers = Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
        const choice = Object.entries(question.criteria).find(([, c]) => c?.kind === 'click' || c?.value === 'Saved')?.[0] ?? '__none__';
        return [key, { choice, confidence: 1 }];
      })); return { answers, model: 'deterministic-package-test' };
    } };
    const core = new JevBrowser({ page, engine });
    try {
      await page.setContent('<h1>Pending</h1><button>Save</button>');
      await page.locator('button').evaluate(e => e.onclick = () => document.querySelector('h1').textContent = 'Saved');
      await core.act('Click Save');
      await expect(page.getByRole('heading')).toHaveText('Saved');
      const result = await core.extract('Heading', z.object({ title: z.string() }), { scope: 'h1' });
      assert.equal(result.data.title, 'Saved');
      await core.close(); assert.equal(page.isClosed(), false);
    } finally { await core.close(); await browser.close(); }
  `], { cwd: directory, env });
  site = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<h1>Pending</h1><button onclick="document.querySelector('h1').textContent='Saved'">Save</button>`); });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${site.address().port}`;
  try {
    await cli(['open', url, '--session', 'package']);
    const snapshot = JSON.parse((await cli(['snapshot', '--session', 'package'])).stdout).result;
    await cli(['click', snapshot.elements.find(e => e.name === 'Save').id, '--session', 'package']);
    await cli(['assert', '--session', 'package', '--args', JSON.stringify({ target: 'h1', property: 'text', expected: 'Saved' })]);
  } finally { await cli(['close', '--session', 'package']); }
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(pkg, 'dist', 'mcp-stdio.js')], cwd: directory, env, stderr: 'pipe' });
  const client = new Client({ name: 'installed-package-proof', version: '1' });
  try {
    await client.connect(transport);
    const tools = await client.listTools(); assert.ok(tools.tools.some(t => t.name === 'browser_click')); assert.ok(tools.tools.some(t => t.name === 'browser_extract'));
    for (const [name, args] of [['browser_navigate', { url }], ['browser_click', { target: 'button' }], ['browser_assert', { target: 'h1', property: 'text', expected: 'Saved' }]]) {
      const result = await client.callTool({ name, arguments: args }); assert.notEqual(result.isError, true, JSON.stringify(result));
    }
  } finally { await client.close(); }
  const goals = await checkInstalledGoal(pkg,directory,env);
  const semantic = await checkInstalledSemantic(pkg,directory,env);
  const resume = await checkInstalledResume(pkg,directory,env);
  const selections = await checkInstalledSelection(pkg,directory,env);
  const screen = await checkInstalledScreen(pkg,directory,env);
  console.log(JSON.stringify({ ...goals, ...semantic, ...resume, ...selections, ...screen, package: packed.name, version: packed.version, filename: packed.filename, sha256: createHash('sha256').update(await readFile(tarball)).digest('hex'), installedSDK: true, nativePlaywrightAssertions: true, installedPersistentCLI: true, installedMCP: true, entryCount: packed.entryCount }, null, 2));
} finally {
  if (site) { site.closeAllConnections(); await new Promise(resolve => site.close(resolve)); }
  await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
}
