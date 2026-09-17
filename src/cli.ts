#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { JevBrowser } from './browser.js';
import { parseCommand, executeCommand } from './commands.js';
import { BrowserError, publicError } from './errors.js';
import { startMcpStdio } from './stdio.js';

const help = `jev-browser — one Jev/Playwright core, three interfaces

  jev-browser snapshot --url https://example.com
  jev-browser act "Click Save" --url https://example.com
  jev-browser extract "Read the title" --url https://example.com --fields '{"title":"string"}'
  jev-browser session                    JSONL commands; keeps one browser alive
  jev-browser mcp                        official MCP stdio server

Commands: goto, snapshot, observe, act, extract, run, screenshot, session, mcp
Options: --url URL  --scope CSS  --values JSON  --fields JSON  --plan-id ID
         --max-steps N  --timeout-ms N  --model NAME  --headed  --help  --version

Session input example: {"id":1,"command":"act","instruction":"Fill the email","values":{"email":"test@example.com"}}
All commands return JSON. Session returns one JSON object per line, preserving id.
One-shot invocations use fresh browsers: use session/MCP/SDK to keep state.
Input values must be explicit named bindings. Set JEV_API_KEY (or TYPESAFE_API_KEY).
Exit status: 0 command succeeded, 1 error, 2 run stopped or completion unverified.
No generated JavaScript, no automatic mutation retries, no deterministic pass from an AI opinion.
`;
async function write(value: unknown): Promise<void> {
  if (!process.stdout.write(`${JSON.stringify(value)}\n`)) await once(process.stdout, 'drain');
}
function readJSON(value: string, name: string): unknown {
  try { return JSON.parse(value); } catch { throw new BrowserError('INVALID_ARGUMENT', `${name} must be valid JSON.`); }
}
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' }, headed: { type: 'boolean' },
    url: { type: 'string' }, scope: { type: 'string' }, values: { type: 'string' }, fields: { type: 'string' },
    'plan-id': { type: 'string' }, 'max-steps': { type: 'string' }, 'timeout-ms': { type: 'string' }, model: { type: 'string' },
  } });
  if (values.version) { process.stdout.write('0.1.0\n'); return; }
  if (values.help || !positionals.length) { process.stdout.write(help); return; }
  const [name, ...words] = positionals;
  const options = { headless: !values.headed, timeoutMs: values['timeout-ms'] ? Number(values['timeout-ms']) : undefined, model: values.model };
  if (name === 'mcp') { startMcpStdio(options); return; }
  let request;
  if (name !== 'session') {
    request = parseCommand({ command: name,
      ...(name === 'goto' ? { url: words.join(' ') || values.url } : words.length ? { instruction: words.join(' ') } : {}),
      ...(values.scope ? { scope: values.scope } : {}),
      ...(values.values ? { values: readJSON(values.values, '--values') } : {}),
      ...(values.fields ? { fields: readJSON(values.fields, '--fields') } : {}),
      ...(values['plan-id'] ? { planId: values['plan-id'] } : {}),
      ...(values['max-steps'] ? { maxSteps: Number(values['max-steps']) } : {}),
    });
  }
  const browser = await JevBrowser.launch(options);
  const interrupt = () => { void browser.close().finally(() => process.exit(130)); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    if (values.url && name !== 'goto') await browser.goto(values.url);
    if (name === 'session') {
      const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.trim()) continue;
        let id: unknown;
        try {
          const raw = readJSON(line, 'Session command');
          if (typeof raw !== 'object' || raw === null) throw new BrowserError('INVALID_ARGUMENT', 'Session commands must be JSON objects.');
          const { id: requestId, ...input } = raw as Record<string, unknown>; id = requestId;
          const result = await executeCommand(browser, parseCommand(input));
          await write({ ...(id !== undefined ? { id } : {}), ok: true, result });
        } catch (error) {
          process.exitCode = 1;
          await write({ ...(id !== undefined ? { id } : {}), ok: false, error: publicError(error) });
        }
      }
    } else {
      const result = await executeCommand(browser, request!);
      await write({ ok: true, result });
      if ('status' in result && ['stopped', 'unverified'].includes(String(result.status))) process.exitCode = 2;
    }
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    await browser.close();
  }
}
main().catch(async error => { process.exitCode = 1; await write({ ok: false, error: publicError(error) }); });
