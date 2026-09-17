import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JevBrowser } from '../dist/index.js';
import { parseCLI } from '../dist/cli-options.js';
import { inputBindings } from '../dist/actions.js';

test('browser environment setting is available consistently to CLI and SDK launch', () => {
 const old = process.env.JEV_BROWSER; process.env.JEV_BROWSER = 'firefox';
 try { assert.equal(parseCLI(['snapshot']).options.browser, 'firefox'); assert.equal(parseCLI(['snapshot', '--browser', 'chromium']).options.browser, 'chromium'); }
 finally { if (old === undefined) delete process.env.JEV_BROWSER; else process.env.JEV_BROWSER = old; }
});
test('quoted strings preserve escaped characters without inventing or truncating the literal', () => {
 const instruction = String.raw`Type "C:\folder\file.txt" into the path field.`;
 const result = inputBindings(instruction);
 assert.equal(result.values.quoted_0, String.raw`C:\folder\file.txt`);
});
test('missing later form selectors do not leave the first field partially filled', async t => {
 const core = await JevBrowser.launch(); t.after(() => core.close()); await core.page.setContent('<input id=first>');
 await assert.rejects(core.native({ command: 'fill_form', fields: [{ target: '#first', type: 'textbox', value: 'Changed' }, { target: '#missing', type: 'textbox', value: 'Missing' }] }, { timeoutMs: 200 }));
 assert.equal(await core.page.locator('#first').inputValue(), '');
});
test('idle time between JSONL commands does not consume the next command timeout', async () => {
 // The idle gap exceeds the operation budget; cold Firefox startup is not a latency assertion.
 const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), 'session', '--timeout-ms', '5000'], { env: { ...process.env, JEV_API_KEY: '', TYPESAFE_API_KEY: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
 let stdout = '', stderr = '', secondSent = false;
 const result = await new Promise((resolve, reject) => {
   const watchdog = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('JSONL process did not finish')); }, 30000);
   child.stdout.on('data', chunk => {
     stdout += chunk;
     if (!secondSent && stdout.includes('\n')) { secondSent = true; setTimeout(() => child.stdin.end('{"id":2,"command":"snapshot"}\n'), 5500); }
   });
   child.stderr.on('data', c => stderr += c); child.once('error', reject);
   child.once('close', code => { clearTimeout(watchdog); resolve({ code, stdout, stderr }); });
   child.stdin.write('{"id":1,"command":"snapshot"}\n');
 });
 const lines = result.stdout.trim().split('\n').map(JSON.parse);
 assert.equal(result.code, 0, result.stdout + result.stderr); assert.equal(lines.length, 2); assert.ok(lines.every(l => l.ok));
});
