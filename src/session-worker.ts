import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { JevBrowser } from './browser.js';
import { publicURL } from './observation.js';
import { executeCommand, parseCommand } from './commands.js';
import { BrowserError, publicError } from './errors.js';
import type { BrowserLaunchOptions } from './types.js';

interface Start { name: string; directory: string; options: BrowserLaunchOptions; url?: string; idleTimeoutMs: number }
process.once('message', async (input: Start) => {
  let core: JevBrowser | undefined, server: Server | undefined, idle: NodeJS.Timeout | undefined;
  let closing: Promise<void> | undefined;
  const token = randomBytes(32).toString('hex');
  const close = () => closing ??= (async () => {
    clearTimeout(idle);
    await core?.close();
    if (server) { server.close(); server.closeIdleConnections(); }
    await rm(input.directory, { recursive: true, force: true });
  })();
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => { void close(); }, input.idleTimeoutMs);
  };
  for (const name of ['SIGINT', 'SIGTERM'] as const) process.once(name, () => { void close(); });
  try {
    core = await JevBrowser.launch(input.options);
    if (input.url) await core.goto(input.url);
    server = createServer(async (req, res) => {
      const respond = (status: number, value: object) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
      if (req.headers.origin) { respond(403, { ok: false, error: { code: 'ORIGIN_DENIED', message: 'Browser-origin requests are not accepted.' } }); return; }
      const supplied = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${token}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { respond(401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'A private session token is required.' } }); return; }
      if (req.method !== 'POST' || req.url !== '/command') { respond(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown session endpoint.' } }); return; }
      if (closing) { respond(409, { ok: false, error: { code: 'CLOSED', message: 'The session is closing.' } }); return; }
      const abort = new AbortController();
      const disconnected = () => { if (!res.writableEnded) abort.abort(); };
      res.once('close', disconnected);
      try {
        let body = '', bytes = 0;
        for await (const chunk of req) {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 1_048_576) throw new BrowserError('INVALID_ARGUMENT', 'Session command exceeds 1 MiB.');
          body += chunk;
        }
        let data: unknown;
        try { data = JSON.parse(body); } catch { throw new BrowserError('INVALID_ARGUMENT', 'Session commands must be valid JSON.'); }
        touch();
        if (typeof data === 'object' && data !== null && 'command' in data && data.command === 'health') {
          respond(200, { ok: true, result: { session: input.name, status: 'open' } }); return;
        }
        const command = parseCommand(data);
        if (command.command === 'close') { await close(); respond(200, { ok: true, result: { status: 'closed' } }); return; }
        const result = await executeCommand(core!, command, abort.signal);
        if (!res.destroyed) respond(200, { ok: true, result });
      } catch (error) {
        if (!res.destroyed) respond(400, { ok: false, error: publicError(error) });
      } finally { res.off('close', disconnected); if (!closing) touch(); }
    });
    server.requestTimeout = 300_000; server.headersTimeout = 15_000;
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local listener');
    await writeFile(join(input.directory, 'session.json'), JSON.stringify({ name: input.name, cwd: resolve(process.cwd()), pid: process.pid, port: address.port, token, createdAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
    touch();
    process.send?.({ ready: true, url: publicURL(core.page.url()) });
  } catch (error) {
    process.send?.({ error: publicError(error) });
    await close(); process.exitCode = 1;
    process.disconnect?.();
  }
});
