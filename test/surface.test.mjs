import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sdk from '../dist/index.js';
test('SDK exposes the shared browser core and Jev decision engine', () => {
  assert.equal(typeof sdk.JevBrowser, 'function');
  assert.equal(typeof sdk.JevDecisionEngine, 'function');
});
