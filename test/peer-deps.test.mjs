import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('Playwright and zod are peer dependencies the caller shares, not bundled copies', () => {
  assert.equal(pkg.dependencies?.playwright, undefined);
  assert.equal(pkg.dependencies?.['playwright-core'], undefined);
  assert.equal(pkg.dependencies?.zod, undefined);
  assert.deepEqual(pkg.peerDependencies, { '@cloudflare/playwright': '^1.3.6', 'playwright-core': '>=1.62.0 <2', zod: '^4.2.0' });
  // @cloudflare/playwright is only for the ./workers entry (Cloudflare Browser Run).
  assert.deepEqual(pkg.peerDependenciesMeta, { '@cloudflare/playwright': { optional: true } });
  assert.equal(pkg.devDependencies['@cloudflare/playwright'], '1.3.6');
  // Development pins the newest supported versions exactly.
  assert.equal(pkg.devDependencies['playwright-core'], '1.63.0');
  assert.equal(pkg.devDependencies['@playwright/test'], '1.63.0');
  assert.match(pkg.devDependencies.zod, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.devDependencies.playwright, undefined);
});

test('source imports playwright-core, never the playwright package', async () => {
  const dir = new URL('../src/', import.meta.url);
  for (const name of await readdir(dir)) {
    const source = await readFile(new URL(name, dir), 'utf8');
    assert.doesNotMatch(source, /['"]playwright(?:\/[^'"]*)?['"]/, `${name} imports playwright`);
  }
});

test('an unsupported playwright-core is a CONFIG error naming the supported range', async () => {
  const { assertPlaywrightCore, playwrightCoreVersion } = await import('../dist/playwright-core-version.js');
  assert.equal(playwrightCoreVersion(), createRequire(import.meta.url)('playwright-core/package.json').version);
  for (const version of ['1.62.0', '1.63.0', '1.99.3', '1.64.0-alpha-2026-09-01']) assert.doesNotThrow(() => assertPlaywrightCore(version), version);
  for (const version of ['1.61.9', '1.49.0', '0.63.0', '2.0.0', 'garbage']) {
    assert.throws(() => assertPlaywrightCore(version), error => {
      assert.equal(error.name, 'BrowserError'); assert.equal(error.code, 'CONFIG');
      assert.match(error.message, /playwright-core >=1\.62\.0 <2/); assert.ok(error.message.includes(version));
      return true;
    }, version);
  }
  assert.doesNotThrow(() => assertPlaywrightCore());
});
