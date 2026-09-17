import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { JevBrowser } from '../dist/index.js';
import { fixtureBrowser, select } from './helpers.mjs';
let browser;
before(async () => { browser = await fixtureBrowser(); });
after(async () => { await browser?.close(); });
async function fixture(t, html, options = {}) {
 const context = await browser.newContext(); const page = await context.newPage(); await page.setContent(html);
 const core = new JevBrowser({ page, ...options }); t.after(async () => { await core.close(); await context.close(); }); return { core, page, context };
}
test('snapshot references remain usable across independent form fills and assertions', async t => {
 const { core, page } = await fixture(t, '<label>First<input></label><label>Second<input></label>');
 const snap = await core.snapshot(); const [first, second] = snap.elements;
 await core.native({ command: 'type', ref: first.id, text: 'A' });
 await core.native({ command: 'type', ref: second.id, text: 'B' });
 await core.native({ command: 'assert', ref: first.id, property: 'value', expected: 'A' });
 assert.deepEqual(await page.locator('input').evaluateAll(es => es.map(e => e.value)), ['A', 'B']);
});
test('invalid later form values are refused before the first field mutates', async t => {
 const { core, page } = await fixture(t, '<input id=first><input id=agree type=checkbox>');
 await assert.rejects(core.native({ command: 'fill_form', fields: [{ target: '#first', type: 'textbox', value: 'Changed' }, { target: '#agree', type: 'checkbox', value: 'not a boolean' }] }), { code: 'INVALID_ARGUMENT' });
 assert.equal(await page.locator('#first').inputValue(), '');
});
test('invalid constructor limits do not attach browser listeners', async t => {
 const page = await browser.newPage(); t.after(() => page.close());
 const before = page.listenerCount('dialog');
 assert.throws(() => new JevBrowser({ page, maxElements: 0 }), { code: 'CONFIG' });
 assert.equal(page.listenerCount('dialog'), before);
});
test('interrupted native dialog execution is settled and the session remains usable', async t => {
 const { core, page } = await fixture(t, `<button onclick="alert('Stop')">Alert</button>`, { timeoutMs: 1000 });
 const r = await core.native({ command: 'click', target: 'button' }); assert.equal(r.status, 'dialog');
 await new Promise(resolve => setTimeout(resolve, 1100));
 await core.native({ command: 'handle_dialog', accept: false }).catch(() => undefined);
 const s = await core.snapshot(); assert.ok(s.elements.some(e => e.name === 'Alert'));
});
test('sequential dialogs can both be answered without losing the pending action', async t => {
 const { core, page } = await fixture(t, `<button onclick="document.body.dataset.a=prompt('First');document.body.dataset.b=prompt('Second')">Ask</button>`);
 assert.equal((await core.native({ command: 'click', target: 'button' })).status, 'dialog');
 const second = await core.native({ command: 'handle_dialog', accept: true, promptText: 'A' }); assert.equal(second.status, 'dialog');
 await core.native({ command: 'handle_dialog', accept: true, promptText: 'B' });
 assert.deepEqual(await page.locator('body').evaluate(e => [e.dataset.a, e.dataset.b]), ['A', 'B']);
});
test('output directories cannot escape via a symlink', { skip: process.platform === 'win32' }, async t => {
 const root = await mkdtemp(join(tmpdir(), 'jev-path-test-')); t.after(() => rm(root, { recursive: true, force: true }));
 const output = join(root, 'out'); const outside = join(root, 'outside'); await mkdir(output); await mkdir(outside); await symlink(outside, join(output, 'link'));
 const { core } = await fixture(t, '<p>Screenshot</p>', { outputDir: output });
 await assert.rejects(core.native({ command: 'take_screenshot', filename: 'link/escape.png' }), { code: 'FILE_ACCESS_DENIED' });
});
test('file input symlinks cannot widen the permitted read root', { skip: process.platform === 'win32' }, async t => {
 const root = await mkdtemp(join(tmpdir(), 'jev-input-test-')); t.after(() => rm(root, { recursive: true, force: true }));
 const input = join(root, 'in'); await mkdir(input); const outside = join(root, 'outside.txt'); await writeFile(outside, 'not shared'); await symlink(outside, join(input, 'link.txt'));
 const { core, page } = await fixture(t, '<input type=file>', { fileRoots: [input] });
 await assert.rejects(core.native({ command: 'file_upload', target: 'input', paths: [join(input, 'link.txt')] }), { code: 'FILE_ACCESS_DENIED' });
 assert.equal(await page.locator('input').evaluate(e => e.files.length), 0);
});
test('closing a WebSocket attachment preserves pre-existing remote contexts', async t => {
 const server = await chromium.launchServer({ headless: true }); t.after(() => server.close());
 const owner = await chromium.connect(server.wsEndpoint()); const page = await owner.newPage(); await page.setContent('<h1>Remote owned</h1>');
 t.after(() => owner.close());
 const attached = await JevBrowser.launch({ wsEndpoint: server.wsEndpoint() });
 await attached.close();
 assert.equal(await page.locator('h1').textContent(), 'Remote owned'); assert.equal(page.isClosed(), false);
});
test('page evaluation runs in the browser realm and respects the opt-in', async t => {
 const { core } = await fixture(t, '<p>Page</p>', { allowEvaluate: true });
 const r = await core.native({ command: 'evaluate', function: '(arg) => ({ realm: typeof process, value: arg.value + 1 })', arg: { value: 41 } });
 assert.deepEqual(r.value, { realm: 'undefined', value: 42 });
});
test('native selectors can address child frames explicitly', async t => {
 const { core, page } = await fixture(t, '<label>Name<input></label><iframe srcdoc="<label>Name<input></label>"></iframe>');
 await page.frameLocator('iframe').getByRole('textbox').waitFor();
 await core.native({ command: 'type', target: 'input', frame: 1, text: 'Inside' });
 assert.equal(await page.frameLocator('iframe').getByRole('textbox').inputValue(), 'Inside');
 assert.equal(await page.locator('input').inputValue(), '');
});

test('model observation IDs stay readable and stable while public refs expire', async t => {
 const engine = select(c => c.kind === 'fill' && c.valueKey === 'name');
 const { core } = await fixture(t, '<label>Name<input value="old"></label>', { engine });
 const a = await core.observe('Fill name', { values: { name: 'New' } });
 const b = await core.observe('Fill name', { values: { name: 'New' } });
 assert.notEqual(a.action.target.id, b.action.target.id);
 const first = engine.requests[0], second = engine.requests[1];
 assert.equal(first.state.page.elements[0].id, second.state.page.elements[0].id);
 assert.equal(first.state.page.elements[0].id, 'e0_0');
 const candidate = Object.values(second.questions.action.criteria).find(c => c?.kind === 'fill');
 assert.equal(candidate.target.id, 'e0_0');
});
