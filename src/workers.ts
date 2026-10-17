import type { BrowserContextOptions, Page } from 'playwright-core';
import { JevBrowser } from './browser.js';
import { BrowserError } from './errors.js';
import type { BrowserOptions } from './types.js';

/**
 * Cloudflare Workers / Agents entry: drive a Cloudflare Browser Run browser from inside a Worker or Durable Object,
 * through the Browser Run binding and `@cloudflare/playwright` (an optional peer dependency; add it to the Worker).
 * Nothing here reads package files or spawns processes, so it bundles with Wrangler (`nodejs_compat`).
 */
export interface BrowserRunOptions extends Omit<BrowserOptions, 'page'> {
  /** Milliseconds Browser Run keeps the browser after the last connection closes (10_000 to 600_000). */
  keepAlive?: number;
  /** Record the session (Browser Run session recording; read it with the recording REST API after the session closes). */
  recording?: boolean;
  /** Options for the new browser context, for example a viewport. */
  contextOptions?: BrowserContextOptions;
}

export interface BrowserRunSession {
  browser: JevBrowser;
  /** Browser Run session ID (for the recording). */
  sessionId: string | undefined;
}

/** The part of `@cloudflare/playwright` this entry uses. */
interface CloudflarePlaywright {
  launch(endpoint: unknown, options?: { keep_alive?: number; recording?: boolean }): Promise<{
    sessionId(): string | undefined;
    newContext(options?: BrowserContextOptions): Promise<{ newPage(): Promise<unknown> }>;
    close(): Promise<void>;
  }>;
}

/** Launch a Browser Run browser from the binding (`env.BROWSER`) and return a JevBrowser on a new page. Closing it closes the browser. */
export async function launchBrowserRun(binding: unknown, options: BrowserRunOptions = {}): Promise<BrowserRunSession> {
  const { keepAlive, recording, contextOptions, ...rest } = options;
  let cf: CloudflarePlaywright;
  try { cf = await import('@cloudflare/playwright') as unknown as CloudflarePlaywright; }
  catch (error) { throw new BrowserError('CONFIG', 'launchBrowserRun needs @cloudflare/playwright in the Worker (npm install @cloudflare/playwright).', { cause: error }); }
  const browser = await cf.launch(binding, { ...(keepAlive !== undefined ? { keep_alive: keepAlive } : {}), ...(recording !== undefined ? { recording } : {}) });
  try {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage() as Page;
    return { browser: JevBrowser.attachExternal({ ...rest, captureDialogs: rest.captureDialogs ?? true, page }, () => browser.close()), sessionId: browser.sessionId() };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/** Attach to a Page you opened yourself with `@cloudflare/playwright`. You keep ownership of its browser. */
export function attachBrowserRunPage(page: unknown, options: Omit<BrowserOptions, 'page'> = {}): JevBrowser {
  return JevBrowser.attachExternal({ ...options, page: page as Page }, async () => {});
}

export { JevBrowser };
export { BrowserError } from './errors.js';
export type { DecisionEngine, DecisionRequest, DecisionResult } from './decision.js';
export type { ScreenJudge, ScreenJudgeInput, ScreenJudgeResult } from './screen-judge.js';
