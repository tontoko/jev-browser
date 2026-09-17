// Explicit opt-in, real Jev, synthetic records only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JevBrowser } from '../dist/index.js';
import { httpServer } from './helpers.mjs';
test('LIVE release: quoted field names are not confused with quoted input values', async t => {
 const core = await JevBrowser.launch(); t.after(() => core.close());
 await core.page.setContent('<label>Name<input></label><label>Email<input></label>');
 const result = await core.act('Fill the "Name" field with "Alice Example". Do not modify Email.');
 assert.equal(await core.page.getByRole('textbox', { name: 'Name', exact: true }).inputValue(), 'Alice Example');
 assert.equal(await core.page.getByRole('textbox', { name: 'Email', exact: true }).inputValue(), '');
 console.log(JSON.stringify({ case: 'quoted-input', model: result.plan.decision.model }));
});
const rows = '<table><thead><tr><th>Student</th><th>Status</th><th>Fee</th></tr></thead><tbody><tr><td>Alice</td><td>Active</td><td>1,200円</td></tr><tr><td>Bob</td><td>Inactive</td><td>9,900円</td></tr><tr><td>Carol</td><td>Active</td><td>2,500円</td></tr></tbody></table>';
test('LIVE release: nested arrays filter observed records and keep names with their fees', async t => {
 const core = await JevBrowser.launch({ timeoutMs: 60000 }); t.after(() => core.close()); await core.page.setContent(rows);
 const result = await core.extract('Read the active students only, preserving the table order. Do not include inactive students.', z.object({ students: z.array(z.object({ name: z.string().describe('Student name only'), fee: z.number().describe('Fee in yen from this student row') })) }), { recordsScope: 'tbody tr' });
 assert.deepEqual(result.data, { students: [{ name: 'Alice', fee: 1200 }, { name: 'Carol', fee: 2500 }] });
 assert.ok(result.evidence['students.0.fee'].context.includes('Alice')); assert.ok(result.evidence['students.1.name'].context.includes('Carol'));
 console.log(JSON.stringify({ case: 'filtered-array', decisions: result.decisions?.length, model: result.decision?.model }));
});
test('LIVE release: persistent CLI performs a real AI operation across separate invocations', async t => {
 const directory = await mkdtemp(join(tmpdir(), 'jev-live-session-')); const script = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
 const site = await httpServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<label>Name<input></label>'); });
 const cli = args => new Promise((resolve, reject) => {
   const child = spawn(process.execPath, [script, ...args], { cwd: directory, env: { ...process.env, JEV_SESSION_DIR: join(directory, 'sessions') }, stdio: ['ignore', 'pipe', 'pipe'] });
   let stdout = '', stderr = ''; child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c);
   const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Live session CLI did not finish')); }, 60000);
   child.once('error', e => { clearTimeout(timer); reject(e); }); child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
 });
 t.after(async () => { await cli(['close', '--session', 'live']); await site.close(); await rm(directory, { recursive: true, force: true }); });
 let r = await cli(['open', site.url, '--session', 'live']); assert.equal(r.code, 0, r.stdout + r.stderr);
 r = await cli(['act', 'Fill the Name field with name.', '--values', JSON.stringify({ name: 'Live CLI Student' }), '--session', 'live']); assert.equal(r.code, 0, r.stdout + r.stderr);
 const model = JSON.parse(r.stdout).result.plan.decision.model;
 r = await cli(['assert', '--args', JSON.stringify({ target: 'input', property: 'value', expected: 'Live CLI Student' }), '--session', 'live']); assert.equal(r.code, 0, r.stdout + r.stderr);
 console.log(JSON.stringify({ case: 'persistent-cli', model }));
});
