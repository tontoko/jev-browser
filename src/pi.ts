import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { JevBrowser } from './browser.js';
import { commandSchemas, executeCommand, parseCommand } from './commands.js';
import { BrowserError, publicError } from './errors.js';
import { screenSchema, type ScreenResult } from './screen.js';
import type { BrowserLaunchOptions } from './types.js';

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
interface ToolResult { content: Content[]; details: object }
interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  executionMode: 'sequential';
  execute(toolCallId: string, input: unknown, signal?: AbortSignal): Promise<ToolResult>;
}

/** The registration subset of Pi's API. Pi remains an optional host dependency. */
export interface PiExtensionAPI {
  registerTool(tool: ToolDefinition): void;
  on(event: 'session_shutdown', handler: () => Promise<void>): unknown;
}

function parameters(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...json } = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' });
  return { type: 'object', ...json };
}

function configuration(): { url: string; options: Readonly<BrowserLaunchOptions> } {
  const url = process.env.JEV_SCREEN_URL;
  try {
    if (!url || !['http:', 'https:'].includes(new URL(url).protocol)) throw new Error();
  } catch {
    throw new Error('JEV_SCREEN_URL must contain the trusted initial HTTP(S) URL.');
  }
  let options: BrowserLaunchOptions = {};
  if (process.env.JEV_SCREEN_OPTIONS) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(process.env.JEV_SCREEN_OPTIONS, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      options = parsed as BrowserLaunchOptions;
    } catch {
      throw new Error('JEV_SCREEN_OPTIONS must name a readable JSON file containing BrowserLaunchOptions.');
    }
  }
  const browser = (options.browser ?? process.env.JEV_BROWSER ?? 'chromium') as BrowserLaunchOptions['browser'];
  return { url: url!, options: Object.freeze({ ...options, browser }) };
}

/** Await startup without allowing cancellation to discard or recreate its browser. */
async function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function screenResult(result: ScreenResult): ToolResult {
  const metadata = {
    observationId: result.observationId,
    viewport: result.viewport,
    action: result.action,
    frames: result.frames.map((frame, index) => ({
      index, mimeType: frame.mimeType, capturedAt: frame.capturedAt, elapsedMs: frame.elapsedMs,
    })),
  };
  return {
    content: [
      { type: 'text', text: JSON.stringify(metadata) },
      ...result.frames.map(frame => ({ type: 'image' as const, data: frame.data, mimeType: frame.mimeType })),
    ],
    details: metadata,
  };
}

/** A single screenshot-only browser session, controlled through Pi's native tool loop. */
export default function jevBrowserExtension(pi: PiExtensionAPI): void {
  // Capture trusted configuration before the actor starts. Tool inputs cannot change it.
  const config = configuration();
  const lifetime = new AbortController();
  let pendingBrowser: Promise<JevBrowser> | undefined;
  let ownedBrowser: JevBrowser | undefined;
  let closing: Promise<void> | undefined;
  let closed = false;

  function browser(): Promise<JevBrowser> {
    if (closed) throw new BrowserError('SCREEN_SESSION_CLOSED', 'This browser session is closed.');
    return pendingBrowser ??= (async () => {
      let core: JevBrowser | undefined;
      try {
        core = ownedBrowser = await JevBrowser.launch({ ...config.options, screenOnly: true });
        lifetime.signal.throwIfAborted();
        // The initial URL is trusted bootstrap configuration, never an actor argument.
        await core.page.goto(config.url, { waitUntil: 'domcontentloaded' });
        lifetime.signal.throwIfAborted();
        return core;
      } catch {
        await core?.close().catch(() => undefined);
        throw new BrowserError('SCREEN_START_FAILED', 'The browser could not be started.');
      }
    })();
  }

  async function close(): Promise<void> {
    closed = true;
    lifetime.abort();
    return closing ??= (async () => {
      const core = ownedBrowser ?? await pendingBrowser?.catch(() => undefined);
      if (core) await executeCommand(core, parseCommand({ command: 'close' }));
    })();
  }

  pi.registerTool({
    name: 'browser_screen',
    label: 'Browser screen',
    description: 'Observe the actual browser viewport, or perform one native coordinate or keyboard action and observe the result. Start with action look. Input actions require the latest observationId. Coordinates are viewport CSS pixels. capture requests a short sequence of actual frames for observing motion. Frames are chronological; choose coordinates for the next input from the last frame.',
    parameters: parameters(screenSchema),
    executionMode: 'sequential',
    async execute(_toolCallId, input, signal) {
      try {
        signal?.throwIfAborted();
        const parsed = screenSchema.safeParse(input);
        if (!parsed.success) throw new BrowserError('INVALID_ARGUMENT', 'Invalid arguments for browser_screen. See the tool input schema.');
        const operationSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
        const core = await abortable(browser(), operationSignal);
        const result = await executeCommand(core, { ...parsed.data, command: 'screen' }, operationSignal);
        return screenResult(result as ScreenResult);
      } catch (error) {
        const { code, message } = publicError(error);
        // Pi marks thrown tool errors as failed. Never expose stacks, source evidence,
        // configuration, or artifact paths through an error's additional fields.
        throw new Error(JSON.stringify({ error: { code, message } }));
      }
    },
  });

  pi.registerTool({
    name: 'browser_close',
    label: 'Close browser',
    description: 'Close this browser session. Closing is final for this Pi session; it does not open a replacement browser.',
    parameters: parameters(commandSchemas.close),
    executionMode: 'sequential',
    async execute(_toolCallId, input, signal) {
      try {
        signal?.throwIfAborted();
        if (!commandSchemas.close.safeParse(input).success)
          throw new BrowserError('INVALID_ARGUMENT', 'Invalid arguments for browser_close. See the tool input schema.');
        await close();
        const details = { status: 'closed' };
        return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
      } catch (error) {
        const { code, message } = publicError(error);
        throw new Error(JSON.stringify({ error: { code, message } }));
      }
    },
  });
  pi.on('session_shutdown', close);
}
