import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { JevBrowser } from './browser.js';
import { createMcpServer } from './mcp.js';
import { BrowserError, publicError } from './errors.js';
import type { BrowserLaunchOptions } from './types.js';

/** The official SDK owns transport and protocol; browser launch is lazy. */
export function startMcpStdio(options: BrowserLaunchOptions = {}, initialURL?: string): void {
  let browser: Promise<JevBrowser> | undefined;
  let ownedBrowser: JevBrowser | undefined;
  let closing = false;
  const getBrowser = async () => {
    if (closing) throw new BrowserError('CLOSED', 'This browser session is closed.');
    if (browser) {
      const current = browser, core = await current;
      if (closing || core.isClosed && options.screenOnly)
        throw new BrowserError('CLOSED', 'This browser session is closed.');
      if (!core.isClosed) return core;
      if (browser === current) browser = undefined;
    }
    return browser ??= JevBrowser.launch(options).then(async core => {
      ownedBrowser = core;
      if (closing) { await core.close(); throw new BrowserError('CLOSED', 'This browser session is closed.'); }
      try { if (initialURL) await core.goto(initialURL); return core; }
      catch (error) { await core.close(); throw error; }
    });
  };
  const closeBrowser = async () => {
    closing = true;
    await ownedBrowser?.close();
    // Startup may still be launching; its continuation observes closing before navigation.
    await browser?.catch(() => undefined);
  };
  const report = (error: unknown) => { process.stderr.write(`${JSON.stringify(publicError(error))}\n`); };
  const handle = serveStdio(() => {
    const server = createMcpServer(getBrowser, { screenOnly: options.screenOnly });
    server.server.onclose = () => { void closeBrowser().catch(report); };
    return server;
  }, { onerror: report });
  process.stdin.once('end', () => { void closeBrowser().catch(report); });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    void handle.close().then(closeBrowser).catch(report);
  });
}
