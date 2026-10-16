import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { BrowserError, type BrowserErrorCode, type PublicError } from './errors.js';
import type { BrowserLaunchOptions } from './types.js';
import type { Command } from './commands.js';
import { sameCapabilities, type Capability } from './capabilities.js';

export const descriptorSchema = z.object({ name: z.string(), cwd: z.string(), pid: z.number().int().positive(), port: z.number().int().min(1).max(65535), token: z.string().regex(/^[0-9a-f]{64}$/), createdAt: z.string(), optionsHash: z.string().regex(/^[0-9a-f]{64}$/).optional() });
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && typeof v !== 'function').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}
/** Everything a session worker fixes at start, including its CLI capabilities. API keys are excluded so rotating one does not strand a session. */
export function launchOptionsHash(options: BrowserLaunchOptions, capabilities: readonly Capability[] = []): string {
  const { apiKey: _apiKey, cdpHeaders: _cdpHeaders, vision, ...rest } = options;
  const fixed = { ...rest, ...(vision && typeof vision === 'object' && !('describe' in vision) ? { vision: { ...vision, apiKey: undefined } } : {}) };
  return createHash('sha256').update(JSON.stringify(canonical({ ...fixed, capabilities: [...capabilities].sort() }))).digest('hex');
}
export function sessionRoot(): string { return resolve(process.env.JEV_SESSION_DIR ?? join(tmpdir(), `jev-browser-${process.getuid?.() ?? 'user'}`)); }
export function sessionDirectory(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) throw new BrowserError('INVALID_ARGUMENT', 'Session names must be 1–64 letters, digits, underscores or hyphens.');
  const namespace = createHash('sha256').update(resolve(process.cwd())).digest('hex').slice(0, 16);
  return join(sessionRoot(), `${namespace}-${name}`);
}
async function descriptor(name: string) {
  const path = join(sessionDirectory(name), 'session.json');
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile() || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid!()))) throw new BrowserError('SESSION_ACCESS', 'Session descriptor must be a private regular file owned by this user.');
    return descriptorSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error instanceof BrowserError) throw error;
    throw new BrowserError('SESSION_NOT_FOUND', `Session ${name} is not available. Start it with open --session ${name}.`);
  }
}
export async function hasSession(name: string): Promise<boolean> {
  try { await descriptor(name); return true; } catch (error) { if (error instanceof BrowserError && error.code === 'SESSION_NOT_FOUND') return false; throw error; }
}
export async function sendSession(name: string, command: Command | { command: 'health' }, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const d = await descriptor(name);
  let response: Response;
  try { response = await fetch(`http://127.0.0.1:${d.port}/command`, { method: 'POST', headers: { authorization: `Bearer ${d.token}`, 'content-type': 'application/json' }, body: JSON.stringify(command), signal: signal ?? AbortSignal.timeout(300_000) }); }
  catch { if (signal?.aborted) signal.throwIfAborted(); throw new BrowserError('SESSION_UNAVAILABLE', `Session ${name} is not responding. No browser action was retried.`); }
  const envelope = await response.json() as { ok: boolean; result?: Record<string, unknown>; error?: Partial<PublicError> };
  if (!response.ok || !envelope.ok) {
    const error=new BrowserError(envelope.error?.code ?? 'SESSION_ERROR', envelope.error?.message ?? 'The session command failed.', { retryable: envelope.error?.retryable === true });
    if(envelope.error?.partial)error.partial=envelope.error.partial;
    if(envelope.error?.semantic)error.semantic=envelope.error.semantic;
    if(envelope.error?.details)error.details=envelope.error.details;
    throw error;
  }
  return envelope.result ?? {};
}
export async function openSession(name: string, options: BrowserLaunchOptions, url?: string, idleTimeoutMs = 1_800_000, capabilities: readonly Capability[] = []): Promise<Record<string, unknown>> {
  const directory = sessionDirectory(name), root = sessionRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await lstat(root);
  if (stat.isSymbolicLink() || !stat.isDirectory() || process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid!())) throw new BrowserError('SESSION_ACCESS', 'Session root must be a private directory owned by this user.');
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const previous = await descriptor(name);
    try { process.kill(previous.pid, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw new BrowserError('SESSION_ACCESS', 'Cannot verify the existing session process.');
      // Never kill an unknown process or replay an action after a network failure.
      // Only an owned descriptor whose process no longer exists can be reclaimed.
      await rm(directory, { recursive: true, force: true });
      return openSession(name, options, url, idleTimeoutMs, capabilities);
    }
    const existing = await sendSession(name, { command: 'health' });
    if ((existing.screenOnly === true) !== (options.screenOnly === true))
      throw new BrowserError('SESSION_MODE_MISMATCH', 'An existing session cannot change screen-only mode. Use a different session name.');
    // Capabilities are part of the hash; name them when they are the difference. A descriptor without a hash was written by a
    // worker that predates recorded launch options and capability gating, and so allowed every tool: it never matches.
    if (previous.optionsHash === undefined || previous.optionsHash !== launchOptionsHash(options, capabilities)) {
      const reported = Array.isArray(existing.capabilities) ? existing.capabilities as Capability[] : undefined;
      if (reported && !sameCapabilities(reported, capabilities))
        throw new BrowserError('SESSION_MODE_MISMATCH', `Session ${name} is already open with different capabilities (--caps ${reported.length ? reported.join(',') : 'none'}), which are fixed when a session starts. Repeat the original options, close the session first, or use a different session name.`);
      throw new BrowserError('SESSION_MODE_MISMATCH', previous.optionsHash === undefined
        ? `Session ${name} was started by an older jev-browser version that does not record launch options or enforce --caps. Close it first, or use a different session name.`
        : `Session ${name} is already open with different launch options, which are fixed when a session starts. Repeat the original options, close the session first, or use a different session name.`);
    }
    if (existing.screenOnly === true && url)
      throw new BrowserError('SCREEN_ONLY', 'A screen-only session cannot be reopened at a supplied URL. Continue with screen, or start a new session.');
    if (url) await sendSession(name, { command: 'goto', url });
    return { ...existing, session: name, status: 'open', reused: true };
  }
  return new Promise((resolve, reject) => {
    const child = fork(new URL('./session-worker.js', import.meta.url), [], { cwd: process.cwd(), detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let settled = false;
    const timer = setTimeout(() => fail(new BrowserError('SESSION_START_FAILED', 'Browser session did not start within 30 seconds.')), 30_000);
    const fail = (error: Error) => {
      if (settled) return; settled = true; clearTimeout(timer); child.kill('SIGTERM');
      void rm(directory, { recursive: true, force: true }).finally(() => reject(error));
    };
    child.once('error', fail);
    child.once('exit', () => fail(new BrowserError('SESSION_START_FAILED', 'Browser session exited before it was ready. Check browser installation and launch options.')));
    child.on('message', message => {
      const result = message as { ready?: boolean; error?: { code: BrowserErrorCode; message: string; retryable?: boolean }; url?: string; screenOnly?: boolean };
      if (result.error) { fail(new BrowserError(result.error.code, result.error.message, { retryable: result.error.retryable === true })); return; }
      if (!result.ready || settled) return;
      settled = true; clearTimeout(timer); child.disconnect(); child.unref();
      resolve({ session: name, status: 'open', ...(result.screenOnly ? { screenOnly: true } : { url: result.url }), reused: false });
    });
    child.send({ name, directory, options, optionsHash: launchOptionsHash(options, capabilities), url, idleTimeoutMs, capabilities });
  });
}
export async function listSessions(): Promise<{ sessions: { name: string; cwd: string; pid: number; createdAt: string }[] }> {
  const sessions: { name: string; cwd: string; pid: number; createdAt: string }[] = [];
  let entries: string[];
  try { entries = await readdir(sessionRoot()); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { sessions }; throw error; }
  for (const directory of entries) {
    try {
      const d = descriptorSchema.parse(JSON.parse(await readFile(join(sessionRoot(), directory, 'session.json'), 'utf8')));
      if (d.cwd === resolve(process.cwd())) sessions.push({ name: d.name, cwd: d.cwd, pid: d.pid, createdAt: d.createdAt });
    } catch { /* Ignore incomplete starts and non-session files. */ }
  }
  return { sessions };
}
