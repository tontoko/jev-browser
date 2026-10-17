import { createRequire } from 'node:module';
import { BrowserError } from './errors.js';

/** The playwright-core peer range this package supports. Keep in sync with package.json peerDependencies. */
export const playwrightCoreRange = '>=1.62.0 <2';
let resolved: string | null | undefined;
/**
 * The playwright-core this package resolves: the caller's peer installation, shared with its own Playwright.
 * Resolved on first use, not at import, so the SDK also loads where packages cannot be resolved from disk (Cloudflare Workers);
 * there it returns undefined.
 */
export function playwrightCoreVersion(): string | undefined {
  if (resolved === undefined) {
    try { resolved = (createRequire(import.meta.url)('playwright-core/package.json') as { version: string }).version; }
    catch { resolved = null; }
  }
  return resolved ?? undefined;
}

/** @internal Operation cancellation needs AbortSignal support, which playwright-core added in 1.62. */
export function assertPlaywrightCore(version: string | undefined = playwrightCoreVersion()): void {
  if (version === undefined) throw new BrowserError('CONFIG', `@tontoko/jev-browser could not resolve playwright-core ${playwrightCoreRange}. Install it, for example: npm install --save-dev playwright-core@^1.62.0`);
  const match = /^(\d+)\.(\d+)\.\d+(?:[-+].*)?$/.exec(version);
  if (match && Number(match[1]) === 1 && Number(match[2]) >= 62) return;
  throw new BrowserError('CONFIG', `@tontoko/jev-browser requires playwright-core ${playwrightCoreRange}, but resolved playwright-core ${version}. Install a supported version, for example: npm install --save-dev playwright-core@^1.62.0`);
}
