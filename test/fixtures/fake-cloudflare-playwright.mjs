// Stands in for @cloudflare/playwright in tests: launch(binding, options) opens a local Chromium and records what it was given.
import { chromium } from 'playwright-core';
export const calls = [];
export async function launch(binding, options) {
  calls.push({ binding, options });
  const browser = await chromium.launch({ headless: true });
  return { sessionId: () => 'fake-session', newContext: o => browser.newContext(o), close: () => browser.close(), isConnected: () => browser.isConnected() };
}
