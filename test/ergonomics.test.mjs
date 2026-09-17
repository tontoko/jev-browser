import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JevBrowser } from '../dist/index.js';
import { fixtureBrowser, select, engine } from './helpers.mjs';
let browser;
before(async () => { browser = await fixtureBrowser(); });
after(async () => { await browser?.close(); });
async function fixture(t, html, engine) {
 const page = await browser.newPage(); await page.setContent(html);
 const core = new JevBrowser({ page, engine }); t.after(async () => { await core.close(); await page.close(); }); return { core, page };
}
test('literal quoted input in an instruction is copied, not generated', async t => {
 const decider = select(c => c.kind === 'fill' && c.valueKey === 'quoted_0');
 const { core, page } = await fixture(t, '<label>Name<input></label>', decider);
 await core.act('Type "Alice Example" into the Name field.');
 assert.equal(await page.locator('input').inputValue(), 'Alice Example');
 assert.equal(decider.requests[0].state.inputs[0].userQuotedText, 'Alice Example');
});
test('Japanese quoted input is preserved as an exact local string', async t => {
 const { core, page } = await fixture(t, '<label>氏名<input></label>', select(c => c.kind === 'fill' && c.valueKey === 'quoted_0'));
 await core.act('氏名欄に「検証用の受講者」を入力してください。');
 assert.equal(await page.locator('input').inputValue(), '検証用の受講者');
});
test('explicit named bindings take precedence and remain withheld from the provider', async t => {
 const decider = select(c => c.kind === 'fill' && c.valueKey === 'name');
 const { core, page } = await fixture(t, '<label>Name<input></label>', decider);
 await core.act('Fill "Name" with name.', { values: { name: 'explicit-secret-test-value' } });
 assert.equal(await page.locator('input').inputValue(), 'explicit-secret-test-value');
 assert.ok(!JSON.stringify(decider.requests).includes('explicit-secret-test-value'));
 assert.ok(!decider.requests[0].state.inputs.some(i => i.key === 'quoted_0'));
});
test('agent execute shares the same bounded loop and deterministic completion', async t => {
 const { core, page } = await fixture(t, `<button onclick="document.body.dataset.saved='yes'">Save</button>`, engine((q,r,n) => n.startsWith('effect_') ? 'commit' : c => c?.kind === 'click'));
 const result = await core.agent({ maxSteps: 2, until: p => p.evaluate(() => document.body.dataset.saved === 'yes') }).execute({ instruction: 'Save the page' });
 assert.equal(result.status, 'complete'); assert.equal(result.reason, 'verified'); assert.equal(result.steps.length, 1);
});
test('native slider form fields update the value and emit input and change events', async t => {
 const { core, page } = await fixture(t, '<input id=volume type=range min=0 max=100 step=5 value=0>');
 await page.locator('input').evaluate(e => { e.addEventListener('input', () => e.dataset.input = 'yes'); e.addEventListener('change', () => e.dataset.change = 'yes'); });
 await core.native({ command: 'fill_form', fields: [{ target: '#volume', type: 'slider', value: '75' }] });
 assert.equal(await page.locator('input').inputValue(), '75');
 assert.deepEqual(await page.locator('input').evaluate(e => [e.dataset.input, e.dataset.change]), ['yes', 'yes']);
});
