import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JevBrowser } from '../dist/index.js';
test('native authorization receives validated default values', async t => {
  const browser = await JevBrowser.launch({ allowCommand: command => command.command !== 'check' || command.checked !== true });
  t.after(() => browser.close());
  await browser.page.setContent('<input type=checkbox>');
  await assert.rejects(browser.native({ command: 'check', target: 'input' }), { code: 'ACTION_DENIED' });
  assert.equal(await browser.page.locator('input').isChecked(), false);
});
test('goto uses the native navigation authorization callback', async t => {
  const browser = await JevBrowser.launch({ allowCommand: command => command.command !== 'navigate' });
  t.after(() => browser.close());
  await browser.page.route('https://navigation.example.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Changed</p>' }));
  await assert.rejects(browser.goto('https://navigation.example.invalid/next'), { code: 'ACTION_DENIED' });
  assert.equal(browser.page.url(), 'about:blank');
});
