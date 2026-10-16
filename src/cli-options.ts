import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { BrowserContextOptions } from 'playwright-core';
import { BrowserError } from './errors.js';
import { commandSchemas, parseCommand, type CommandName } from './commands.js';
import type { BrowserLaunchOptions } from './types.js';
import { parseCapabilities } from './capabilities.js';
const definitions = {
  help: { type: 'boolean', short: 'h' }, 'dry-run': { type: 'boolean' }, version: { type: 'boolean' }, headed: { type: 'boolean' },
  'allow-evaluate': { type: 'boolean' }, caps: { type: 'string', multiple: true }, 'screen-only': { type: 'boolean' }, 'screen-follow-popups': { type: 'boolean' }, session: { type: 'string', short: 's' },
  url: { type: 'string' }, scope: { type: 'string' }, frame: { type: 'string' }, args: { type: 'string' },
  values: { type: 'string' }, fields: { type: 'string' }, schema: { type: 'string' }, 'records-scope': { type: 'string' },
  'plan-id': { type: 'string' }, 'max-steps': { type: 'string' }, 'timeout-ms': { type: 'string' }, model: { type: 'string' },
  'max-elements': { type: 'string' }, 'max-texts': { type: 'string' }, 'max-candidates': { type: 'string' }, exclude: { type: 'string', multiple: true },
  browser: { type: 'string' }, 'cdp-endpoint': { type: 'string' }, 'ws-endpoint': { type: 'string' },
  'user-data-dir': { type: 'string' }, 'storage-state': { type: 'string' }, 'output-dir': { type: 'string' },
  'file-root': { type: 'string', multiple: true }, 'idle-timeout-ms': { type: 'string' },
  'options-file': { type: 'string' }, 'vision-base-url': { type: 'string' }, 'vision-model': { type: 'string' }, viewport: { type: 'string' }, 'reduced-motion': { type: 'boolean' }, 'color-scheme': { type: 'string' }, locale: { type: 'string' },
} as const;
const size = z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict();
// Common Playwright fields are checked here; Playwright validates the rest when the browser starts.
const optionsFileSchema = z.object({
  browser: z.enum(['chromium', 'firefox', 'webkit']).optional(), headless: z.boolean().optional(),
  launchOptions: z.object({ args: z.array(z.string()).optional(), channel: z.string().min(1).optional(), executablePath: z.string().min(1).optional(), slowMo: z.number().nonnegative().optional() }).loose().optional(),
  contextOptions: z.object({
    viewport: size.nullable().optional(), screen: size.optional(), deviceScaleFactor: z.number().positive().optional(), isMobile: z.boolean().optional(), hasTouch: z.boolean().optional(),
    colorScheme: z.enum(['light', 'dark', 'no-preference']).nullable().optional(), reducedMotion: z.enum(['reduce', 'no-preference']).nullable().optional(),
    forcedColors: z.enum(['active', 'none']).nullable().optional(), contrast: z.enum(['more', 'no-preference']).nullable().optional(),
    locale: z.string().min(1).optional(), timezoneId: z.string().min(1).optional(), userAgent: z.string().min(1).optional(),
  }).loose().optional(),
  storageState: z.union([z.string().min(1), z.record(z.string(), z.unknown())]).optional(),
  userDataDir: z.string().min(1).optional(), cdpEndpoint: z.string().min(1).optional(), wsEndpoint: z.string().min(1).optional(), cdpHeaders: z.record(z.string(), z.string()).optional(),
}).strict();
type OptionsFile = Pick<BrowserLaunchOptions, 'browser' | 'headless' | 'launchOptions' | 'contextOptions' | 'storageState' | 'userDataDir' | 'cdpEndpoint' | 'wsEndpoint' | 'cdpHeaders'>;
/** Launch and context settings only; paths inside resolve against the working directory, as flags do. */
function readOptionsFile(path: string): OptionsFile {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { throw new BrowserError('INVALID_ARGUMENT', '--options-file could not be read.'); }
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new BrowserError('INVALID_ARGUMENT', '--options-file must contain valid JSON.'); }
  const parsed = optionsFileSchema.safeParse(input);
  if (!parsed.success) throw new BrowserError('INVALID_ARGUMENT', parsed.error.issues.map(issue => `Invalid --options-file${issue.path.length ? ` at ${issue.path.join('.')}` : ''}: ${issue.message}.`).join(' '));
  return parsed.data as OptionsFile;
}
function contextFlags(values: { viewport?: string; 'reduced-motion'?: boolean; 'color-scheme'?: string; locale?: string }): BrowserContextOptions {
  const viewport = values.viewport === undefined ? undefined : /^([1-9]\d{0,4})x([1-9]\d{0,4})$/.exec(values.viewport);
  if (viewport === null) throw new BrowserError('INVALID_ARGUMENT', '--viewport must be WIDTHxHEIGHT in CSS pixels, for example 1280x720.');
  const colorScheme = values['color-scheme'];
  if (colorScheme !== undefined && !['light', 'dark', 'no-preference'].includes(colorScheme)) throw new BrowserError('INVALID_ARGUMENT', '--color-scheme must be light, dark or no-preference.');
  if (values.locale === '') throw new BrowserError('INVALID_ARGUMENT', '--locale must not be empty.');
  return {
    ...(viewport ? { viewport: { width: Number(viewport[1]), height: Number(viewport[2]) } } : {}), ...(values['reduced-motion'] ? { reducedMotion: 'reduce' } : {}),
    ...(colorScheme !== undefined ? { colorScheme: colorScheme as BrowserContextOptions['colorScheme'] } : {}), ...(values.locale !== undefined ? { locale: values.locale } : {}),
  };
}
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
  // Explicit flags win over the options file, which wins over environment defaults.
  const file = values['options-file'] === undefined ? {} : readOptionsFile(values['options-file']);
  const browserName = values.browser ?? file.browser ?? process.env.JEV_BROWSER ?? 'chromium';
  if (!['chromium', 'firefox', 'webkit'].includes(browserName)) throw new BrowserError('INVALID_ARGUMENT', 'Browser must be chromium, firefox or webkit.');
  const contextOptions = { ...file.contextOptions, ...contextFlags(values) };
  // --allow-evaluate is the older spelling of --caps evaluate.
  const capabilities = parseCapabilities(values.caps, values['allow-evaluate']);
  // Image understanding is opt-in and needs both flags; its key comes only from JEV_VISION_API_KEY, never a Jev key.
  const visionBaseURL = values['vision-base-url']?.trim() || undefined, visionModel = values['vision-model']?.trim() || undefined;
  if ((visionBaseURL === undefined) !== (visionModel === undefined)) throw new BrowserError('INVALID_ARGUMENT', '--vision-base-url and --vision-model must be given together.');
  const visionKey = process.env.JEV_VISION_API_KEY?.trim() || undefined;
  if (values['screen-follow-popups'] && !values['screen-only']) throw new BrowserError('INVALID_ARGUMENT', '--screen-follow-popups requires --screen-only.');
  const options: BrowserLaunchOptions = {
    ...file, browser: browserName as BrowserLaunchOptions['browser'], headless: values.headed ? false : file.headless ?? true,
    timeoutMs: positive(values['timeout-ms'], '--timeout-ms'), model: values.model,
    maxElements: positive(values['max-elements'], '--max-elements'), maxTexts: positive(values['max-texts'], '--max-texts'), maxCandidates: positive(values['max-candidates'], '--max-candidates'),
    cdpEndpoint: values['cdp-endpoint'] ?? file.cdpEndpoint, wsEndpoint: values['ws-endpoint'] ?? file.wsEndpoint, cdpHeaders: file.cdpHeaders, userDataDir: values['user-data-dir'] ?? file.userDataDir,
    storageState: values['storage-state'] ?? file.storageState, outputDir: values['output-dir'],
    // CLI/MCP uploads have no implicit read root; --file-root . grants the working directory.
    fileRoots: values['file-root'] ?? [], allowEvaluate: capabilities.includes('evaluate'), screenOnly: values['screen-only'], screenFollowPopups: values['screen-follow-popups'],
    ...(Object.keys(contextOptions).length ? { contextOptions } : {}),
    ...(visionBaseURL && visionModel ? { vision: { baseURL: visionBaseURL, model: visionModel, ...(visionKey ? { apiKey: visionKey } : {}) } } : {}),
  };
  return { values, positionals, options, capabilities };
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
    else if (name === 'resume') args.continuationId = words[0];
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
  // --max-* also set session defaults at launch; commands that observe take them as per-call limits too.
  const schema = Object.hasOwn(commandSchemas, name) ? commandSchemas[name as CommandName] : undefined;
  if (schema && 'shape' in schema && 'maxElements' in schema.shape) {
    if (values['max-elements'] !== undefined) args.maxElements = positive(values['max-elements'], '--max-elements');
    if (values['max-texts'] !== undefined) args.maxTexts = positive(values['max-texts'], '--max-texts');
    if (values['max-candidates'] !== undefined) args.maxCandidates = positive(values['max-candidates'], '--max-candidates');
  }
  if (values.exclude !== undefined) args.exclude = values.exclude;
  return parseCommand({ command: name, ...args });
}
