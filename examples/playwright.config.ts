import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'playwright.spec.ts', workers: 1,
  reporter: 'line', outputDir: '../artifacts/playwright',
  use: { browserName: 'chromium', headless: true },
});
