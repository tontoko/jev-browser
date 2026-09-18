#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { JevBrowser } from './browser.js';
import { parseCommand, executeCommand, commandSchemas } from './commands.js';
import { BrowserError, publicError } from './errors.js';
import { startMcpStdio } from './stdio.js';
import { openSession, sendSession, listSessions, hasSession } from './sessions.js';
import { parseCLI, commandFromCLI, positive, readJSON } from './cli-options.js';
import { version } from './version.js';
const help = `jev-browser — grounded Jev decisions and native Playwright, one SDK / CLI / MCP core

  jev-browser open https://example.com --session work
  jev-browser snapshot --session work
  jev-browser click REF_OR_SELECTOR --session work
  jev-browser fill REF_OR_SELECTOR 'literal text' --session work
  jev-browser act 'Click Save' --session work
  jev-browser extract 'Read title' --fields '{"title":"string"}' --session work
  jev-browser semantic_locate --args '{\"description\":\"The current plan control\"}' --session work\n  jev-browser semantic_compare --args '{\"actual\":{\"description\":\"Current plan\"},\"expected\":\"Professional annual plan\",\"minConfidence\":0.8}' --session work\n  jev-browser semantic_assert --args '{\"actual\":{\"description\":\"Billing status\"},\"expected\":\"Paid\",\"minConfidence\":0.9}' --session work\n  jev-browser assert --args '{"target":"h1","property":"text","expected":"Saved"}' --session work
  jev-browser close --session work
  jev-browser sessions                  List sessions for this working directory
  jev-browser session                   JSONL stdin commands, one browser
  jev-browser mcp                       Official MCP stdio server

All native commands accept --args JSON. 'call COMMAND --args JSON' is equivalent.
Aliases: open, fill, press, select, uncheck, back, forward, upload, screenshot-file.
Commands: ${Object.keys(commandSchemas).join(', ')}

Options:
  --session NAME / -s NAME    Persistent session; open defaults to 'default'
  --url URL                  One-shot initial URL (fresh browser without --session)
  --args JSON                Exact command arguments; '-' reads JSON from stdin
  --values JSON              Named AI input bindings (literal values stay local)
  --fields JSON              Scalar extraction fields
  --schema JSON              JSON Schema for nested objects / arrays
  --records-scope CSS        Repeated record roots for array extraction
  --scope CSS  --frame N     Bound observation or select a native frame
  --plan-id ID  --max-steps N  --timeout-ms N
  --max-elements N  --max-texts N  --max-candidates N
  --browser chromium|firefox|webkit  --headed
  --cdp-endpoint URL  --ws-endpoint URL  --user-data-dir DIR
  --storage-state FILE  --output-dir DIR  --file-root DIR (repeatable)
  --allow-evaluate           Enable trusted page JS; never Node code execution
  --model NAME  --idle-timeout-ms N  --help  --version

Native operations, snapshots and assertions need no API key. AI operations require
JEV_API_KEY (or TYPESAFE_API_KEY). Sessions are local to the current directory.
Exit codes: 0 succeeded, 1 error, 2 stopped/unverified run or pending dialog.
Mutation failures are never automatically retried. Input values may appear on the page.
`;
async function write(value: unknown): Promise<void> {
  if (!process.stdout.write(`${JSON.stringify(value)}\n`)) await once(process.stdout, 'drain');
}
async function main(): Promise<void> {
  const { values, positionals, options } = parseCLI();
  if (values.version) { process.stdout.write(`${version}\n`); return; }
  if (values.help || !positionals.length) { process.stdout.write(help); return; }
  let [name, ...words] = positionals;
  if (name === 'mcp') { startMcpStdio(options); return; }
  if (name === 'sessions') { await write({ ok: true, result: await listSessions() }); return; }
  if (name === 'open') {
    const result = await openSession(values.session ?? 'default', options, words[0] ?? values.url, positive(values['idle-timeout-ms'], '--idle-timeout-ms'));
    await write({ ok: true, result }); return;
  }
  if (name === 'call') { name = words.shift(); if (!name) throw new BrowserError('INVALID_ARGUMENT', 'call requires a command name.'); }
  const request = name === 'session' ? undefined : commandFromCLI(name!, words, values);
  const session = values.session ?? (name === 'close' || !values.url && await hasSession('default') ? 'default' : undefined);
  const abort = new AbortController();
  const interrupt = () => { abort.abort(); process.exitCode = 130; };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const browser = session ? undefined : await JevBrowser.launch(options);
  const execute = (request: ReturnType<typeof parseCommand>) => {
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(options.timeoutMs ?? 300_000)]);
    return session ? sendSession(session, request, signal) : executeCommand(browser!, request, signal);
  };
  try {
    if (values.url && !['goto', 'navigate'].includes(name!)) await execute(parseCommand({ command: 'goto', url: values.url }));
    if (name === 'session') {
      const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.trim()) continue;
        let id: unknown;
        try {
          const raw = readJSON(line, 'Session command');
          if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BrowserError('INVALID_ARGUMENT', 'Session command must be an object.');
          const { id: requestId, ...input } = raw as Record<string, unknown>; id = requestId;
          await write({ ...(id !== undefined ? { id } : {}), ok: true, result: await execute(parseCommand(input)) });
        } catch (error) { process.exitCode = 1; await write({ ...(id !== undefined ? { id } : {}), ok: false, error: publicError(error) }); }
      }
    } else {
      const result = await execute(request!); await write({ ok: true, result });
      if ('status' in result && ['stopped', 'unverified', 'dialog'].includes(String(result.status))) process.exitCode = 2;
    }
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); await browser?.close();
  }
}
main().catch(async error => { process.exitCode = 1; await write({ ok: false, error: publicError(error) }); });
