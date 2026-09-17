import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { BrowserError } from './errors.js';
import { parseCommand } from './commands.js';
import type { BrowserLaunchOptions } from './types.js';
const definitions = {
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' }, headed: { type: 'boolean' },
  'allow-evaluate': { type: 'boolean' }, session: { type: 'string', short: 's' },
  url: { type: 'string' }, scope: { type: 'string' }, frame: { type: 'string' }, args: { type: 'string' },
  values: { type: 'string' }, fields: { type: 'string' }, schema: { type: 'string' }, 'records-scope': { type: 'string' },
  'plan-id': { type: 'string' }, 'max-steps': { type: 'string' }, 'timeout-ms': { type: 'string' }, model: { type: 'string' },
  'max-elements': { type: 'string' }, 'max-texts': { type: 'string' }, 'max-candidates': { type: 'string' },
  browser: { type: 'string' }, 'cdp-endpoint': { type: 'string' }, 'ws-endpoint': { type: 'string' },
  'user-data-dir': { type: 'string' }, 'storage-state': { type: 'string' }, 'output-dir': { type: 'string' },
  'file-root': { type: 'string', multiple: true }, 'idle-timeout-ms': { type: 'string' },
} as const;
export function readJSON(value: string, name: string): unknown {
  try { return JSON.parse(value === '-' ? readFileSync(0, 'utf8') : value); }
  catch { throw new BrowserError('INVALID_ARGUMENT', `${name} must be valid JSON.`); }
}
export function positive(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 2_147_483_647) throw new BrowserError('INVALID_ARGUMENT', `${name} must be a positive integer no larger than 2147483647.`);
  return n;
}
export function parseCLI(argv = process.argv.slice(2)) {
  let parsed;
  try { parsed = parseArgs({ args: argv, allowPositionals: true, options: definitions }); }
  catch { throw new BrowserError('INVALID_ARGUMENT', 'Unknown or invalid CLI option. See --help.'); }
  const { values, positionals } = parsed;
  const browserName = values.browser ?? process.env.JEV_BROWSER ?? 'chromium';
  if (!['chromium', 'firefox', 'webkit'].includes(browserName)) throw new BrowserError('INVALID_ARGUMENT', 'Browser must be chromium, firefox or webkit.');
  const options: BrowserLaunchOptions = {
    browser: browserName as BrowserLaunchOptions['browser'], headless: !values.headed,
    timeoutMs: positive(values['timeout-ms'], '--timeout-ms'), model: values.model,
    maxElements: positive(values['max-elements'], '--max-elements'), maxTexts: positive(values['max-texts'], '--max-texts'), maxCandidates: positive(values['max-candidates'], '--max-candidates'),
    cdpEndpoint: values['cdp-endpoint'], wsEndpoint: values['ws-endpoint'], userDataDir: values['user-data-dir'],
    storageState: values['storage-state'], outputDir: values['output-dir'], fileRoots: values['file-root'], allowEvaluate: values['allow-evaluate'],
  };
  return { values, positionals, options };
}
export function commandFromCLI(name: string, words: string[], values: ReturnType<typeof parseCLI>['values']) {
  const aliases: Record<string, string> = { fill: 'type', press: 'press_key', select: 'select_option', uncheck: 'check', back: 'navigate_back', forward: 'navigate_forward', upload: 'file_upload', 'screenshot-file': 'take_screenshot' };
  const alias = name; name = aliases[name] ?? name;
  let args: Record<string, unknown> = {};
  if (values.args !== undefined) {
    const input = readJSON(values.args, '--args');
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new BrowserError('INVALID_ARGUMENT', '--args must be an object.');
    args = input as Record<string, unknown>;
  } else {
    if (['goto', 'navigate'].includes(name)) args.url = words[0] ?? values.url;
    else if (['act', 'observe', 'extract', 'run'].includes(name) && words.length) args.instruction = words.join(' ');
    else if (['click', 'hover', 'check'].includes(name)) { args.target = words[0]; if (alias === 'uncheck') args.checked = false; }
    else if (name === 'type') { args.target = words[0]; args.text = words.slice(1).join(' '); }
    else if (name === 'press_key') { args.key = words[0]; if (words[1]) args.target = words[1]; }
    else if (name === 'select_option') { args.target = words[0]; args.values = words.slice(1); }
    else if (name === 'file_upload') { args.target = words[0]; args.paths = words.slice(1); }
    else if (name === 'take_screenshot' && words[0]) args.filename = words[0];
    else if (name === 'tabs') { args.action = words[0] ?? 'list'; if (words[1]) args.index = Number(words[1]); }
    else if (name === 'evaluate') args.function = words.join(' ');
    else if (name === 'wait_for') args.text = words.join(' ');
  }
  if (values.scope) args.scope = values.scope;
  if (values.frame !== undefined) args.frame = Number(values.frame);
  if (values.values !== undefined) args.values = readJSON(values.values, '--values');
  if (values.fields !== undefined) args.fields = readJSON(values.fields, '--fields');
  if (values.schema !== undefined) args.schema = readJSON(values.schema, '--schema');
  if (values['records-scope']) args.recordsScope = values['records-scope'];
  if (values['plan-id']) args.planId = values['plan-id'];
  if (values['max-steps']) args.maxSteps = positive(values['max-steps'], '--max-steps');
  return parseCommand({ command: name, ...args });
}
