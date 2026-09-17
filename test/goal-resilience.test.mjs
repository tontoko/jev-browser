import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fixtureBrowser } from './helpers.mjs';
import { goalFixture } from './goal-fixture.mjs';
import { flattenInputs, privateFilter } from '../dist/bindings.js';
let browser;
before(async () => { browser = await fixtureBrowser(); });
after(async () => { await browser?.close(); });

test('goal resilience: a save without supplied inputs is still a single commit', async t => {
  const { core, attempts } = await goalFixture(t, browser, [], { noReadback: true });
  const result = await core.run('Add a new record and Save it once.', { maxSteps: 4, settleTimeoutMs: 150 });
  assert.equal(attempts.length, 1);
  assert.equal(result.status, 'unverified');
  assert.equal(result.reason, 'effect-unknown');
  assert.equal(result.effects.filter(effect => effect.kind === 'commit').length, 1);
});

test('goal resilience: default settling waits for an asynchronous saved result', async t => {
  const { core, page, records, attempts } = await goalFixture(t, browser, [{ path: '/email', label: 'Email', type: 'email' }]);
  await page.route('**/save', async route => {
    const response = await route.fetch();
    await delay(250);
    await route.fulfill({ response });
  });
  const result = await core.run('Add and Save the supplied email.', { values: { email: 'delayed-save@example.invalid' } });
  assert.equal(result.status, 'complete');
  assert.equal(attempts.length, 1);
  assert.equal(records[0]['/email'], 'delayed-save@example.invalid');
});

test('goal resilience: input echoes cannot rewrite protocol fields or input identities', () => {
  const filter = privateFilter(flattenInputs({ name: 'name', state: 'complete', operation: 'click' }));
  const result = filter({ status: 'complete', reason: 'ui-readback', inputs: [{ path: '/name', label: 'name' }],
    action: { kind: 'click', valueKey: '/name' }, page: { texts: [{ text: 'name complete click' }] } });
  assert.equal(result.status, 'complete');
  assert.equal(result.action.kind, 'click');
  assert.equal(result.action.valueKey, '/name');
  assert.equal(result.inputs[0].path, '/name');
  assert.equal(result.inputs[0].label, 'name');
  assert.equal(result.page.texts[0].text, '[input:/name] [input:/state] [input:/operation]');
});

test('goal resilience: redacting one value cannot corrupt a previous replacement token', () => {
  const filter = privateFilter(flattenInputs({ name: 'Secret Name', tag: 'name' }));
  assert.equal(filter({ text: 'Secret Name name' }).text, '[input:/name] [input:/tag]');
});

test('goal resilience: ordinary data equal to protocol words can still be saved and verified', async t => {
  const fields = [{ path: '/name', label: 'name' }, { path: '/state', label: 'state' }, { path: '/operation', label: 'operation' }];
  const { core, records, attempts } = await goalFixture(t, browser, fields);
  const result = await core.run('Add and Save all supplied fields.', { values: { name: 'name', state: 'complete', operation: 'click' } });
  assert.equal(result.status, 'complete', JSON.stringify({ reason: result.reason, inputs: result.inputs, effects: result.effects }));
  assert.deepEqual(result.inputs.map(input => input.path), ['/name', '/state', '/operation']);
  assert.equal(attempts.length, 1);
  assert.deepEqual(records[0], { '/name': 'name', '/state': 'complete', '/operation': 'click' });
});
