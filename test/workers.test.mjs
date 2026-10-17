import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('version is a constant equal to package.json (no package file read at run time)', async () => {
  const { version } = await import('../dist/version.js');
  assert.equal(version, pkg.version);
  assert.doesNotMatch(readFileSync(new URL('../dist/version.js', import.meta.url), 'utf8'), /readFileSync|import\.meta/);
});

test('the DOM bundle is embedded as a module equal to dist/dom.bundle.cjs', async () => {
  const { domSource } = await import('../dist/dom-source.js');
  assert.equal(domSource, readFileSync(new URL('../dist/dom.bundle.cjs', import.meta.url), 'utf8'));
});

test('./workers is exported and bundles for workerd without playwright-core or code generation', async () => {
  assert.deepEqual(pkg.exports['./workers'], { types: './dist/workers.d.ts', import: './dist/workers.js' });
  assert.equal(pkg.peerDependenciesMeta?.['@cloudflare/playwright']?.optional, true);
  const result = await build({
    entryPoints: ['dist/workers.js'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, metafile: true, format: 'esm',
    platform: 'neutral', conditions: ['workerd', 'worker', 'import'], mainFields: ['module', 'main'],
    external: ['@cloudflare/playwright', 'node:*'], logLevel: 'silent',
  });
  const inputs = Object.keys(result.metafile.inputs).map(path => path.replaceAll('\\', '/'));
  assert.ok(!inputs.some(path => path.includes('node_modules/playwright-core')), 'playwright-core must not be bundled');
  for (const path of inputs.filter(path => path.startsWith('dist/'))) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /new Function\(|\beval\(/, path);
  }
});

// Node's Playwright server itself generates code, so code generation is checked statically above and live on workerd (Browser Run).
test('launchBrowserRun opens a Browser Run browser through @cloudflare/playwright and drives its page', () => {
  const child = spawnSync(process.execPath, ['test/fixtures/workers-child.mjs'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 50000 });
  assert.equal(child.status, 0, child.stderr);
  const out = JSON.parse(child.stdout);
  assert.equal(out.sessionId, 'fake-session');
  assert.deepEqual(out.launch, { binding: { binding: 'BROWSER' }, options: { keep_alive: 60000, recording: true } });
  assert.ok(out.snapshot.includes('Go'));
  assert.equal(out.act, 'executed');
  assert.equal(out.hit, '1');
  assert.deepEqual(out.viewport, { width: 1440, height: 900 });
  assert.equal(out.closed, true);
  assert.ok(out.attached.includes('Keep'));
  assert.equal(out.ownOpen, true);
});
