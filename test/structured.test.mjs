import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { JevBrowser } from '../dist/index.js';
import { fixtureBrowser, engine } from './helpers.mjs';
let browser;
before(async () => { browser = await fixtureBrowser(); });
after(async () => { await browser?.close(); });
async function fixture(t, html, decider) {
  const page = await browser.newPage(); await page.setContent(html);
  const core = new JevBrowser({ page, engine: decider });
  t.after(async () => { await core.close(); await page.close(); }); return { core, page };
}
function recordsEngine(only) {
  return engine((q, req) => {
    if ('include' in q.criteria) return only && !q.criteria.include.record.includes(only) ? 'exclude' : 'include';
    const kind = q.instructions.includes('"amount"') ? 'number' : 'string';
    return c => c && typeof c.value === kind && (kind === 'number' || ['Alice', 'Bob', 'Invoice A'].includes(c.value));
  });
}
test('nested SDK objects copy observed values with dotted evidence paths', async t => {
  const { core } = await fixture(t, '<h1>Invoice A</h1><p>12800</p>', recordsEngine());
  const r = await core.extract('Read invoice', z.object({ invoice: z.object({ title: z.string(), amount: z.number() }) }));
  assert.deepEqual(r.data, { invoice: { title: 'Invoice A', amount: 12800 } });
  assert.equal(r.evidence['invoice.title'].text, 'Invoice A');
});
test('arrays preserve row isolation and observed order', async t => {
  const { core } = await fixture(t, '<table><tbody><tr><td>Alice</td><td>10</td></tr><tr><td>Bob</td><td>20</td></tr></tbody></table>', recordsEngine());
  const r = await core.extract('Read all students', z.array(z.object({ name: z.string(), amount: z.number() })), { recordsScope: 'tbody tr' });
  assert.deepEqual(r.data, [{ name: 'Alice', amount: 10 }, { name: 'Bob', amount: 20 }]);
  assert.ok(r.evidence['0.name'].context.includes('Alice'));
  assert.ok(r.evidence['1.amount'].context.includes('Bob'));
});
test('nested array fields select only the records requested', async t => {
  const { core } = await fixture(t, '<ul><li><span>Alice</span> <span>10</span></li><li><span>Bob</span> <span>20</span></li></ul>', recordsEngine('Bob'));
  const r = await core.extract('Only Bob', z.object({ students: z.array(z.object({ name: z.string(), amount: z.number() })) }));
  assert.deepEqual(r.data, { students: [{ name: 'Bob', amount: 20 }] });
});
test('empty observed record lists satisfy arrays without inventing rows', async t => {
  const { core } = await fixture(t, '<table><tbody></tbody></table>', recordsEngine());
  const r = await core.extract('Read rows', z.array(z.object({ name: z.string() })), { recordsScope: 'tbody tr' });
  assert.deepEqual(r.data, []);
  await assert.rejects(core.extract('Read rows', z.array(z.object({ name: z.string() })).min(1), { recordsScope: 'tbody tr' }), { code: 'EXTRACTION_SCHEMA' });
});
test('scalar root schemas are grounded just like object fields', async t => {
  const { core } = await fixture(t, '<h1>Invoice A</h1>', recordsEngine());
  const r = await core.extract('Read the title', z.string());
  assert.equal(r.data, 'Invoice A'); assert.equal(r.evidence.value.text, 'Invoice A');
});
test('link destinations are available as attributed observed evidence', async t => {
  const { core } = await fixture(t, '<a href="https://example.invalid/lesson/42">Lesson details</a>', engine(() => c => c?.value === 'https://example.invalid/lesson/42'));
  const r = await core.extract('Read the lesson link URL', z.object({ url: z.url() }));
  assert.equal(r.data.url, 'https://example.invalid/lesson/42');
  assert.equal(r.evidence.url.attribute, 'href');
});
test('structured schemas cannot inject default-valued nested data', async t => {
  const { core } = await fixture(t, '<p>No data</p>', recordsEngine());
  await assert.rejects(core.extract('Read invoice', z.object({ invoice: z.object({ amount: z.number().default(999) }) })), { code: 'UNSUPPORTED_SCHEMA' });
});
