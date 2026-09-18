import { z } from 'zod';
import type { JevBrowser } from './browser.js';
import { BrowserError } from './errors.js';
import { nativeSchemas, nativeReadOnly, type NativeCommand, type NativeName } from './native-schemas.js';

const scope = z.string().min(1).optional();
const instruction = z.string().trim().min(1);
const values = z.record(z.string().min(1), z.string()).optional();
const fieldType = z.enum(['string', 'number', 'boolean']);
const field = z.union([fieldType, z.object({ type: fieldType, description: z.string().optional(), nullable: z.boolean().optional() }).strict()]);
const confidence = z.number().min(0).max(1).optional();
const semanticActual = z.union([z.object({ description: instruction }).strict(), z.object({ ref: z.string().min(1) }).strict()]);
export const commandSchemas = {
  ...nativeSchemas,
  goto: z.object({ url: z.url() }).strict(),
  snapshot: z.object({ scope }).strict(),
  observe: z.object({ instruction, values, scope }).strict(),
  act: z.object({ instruction: instruction.optional(), planId: z.string().min(1).optional(), values, scope }).strict()
    .refine(v => Number(v.instruction !== undefined) + Number(v.planId !== undefined) === 1, { message: 'Provide exactly one of instruction or planId.' }),
  extract: z.object({ instruction, fields: z.record(z.string().min(1), field).optional(), schema: z.record(z.string(), z.unknown()).optional(), scope, recordsScope: scope }).strict()
    .refine(v => Number(v.fields !== undefined) + Number(v.schema !== undefined) === 1, { message: 'Provide exactly one of fields or schema (JSON Schema).' }),
  semantic_locate: z.object({ description: instruction, minConfidence: confidence, scope }).strict(),
  semantic_compare: z.object({ actual: semanticActual, expected: z.string().min(1), minConfidence: confidence, minSourceConfidence: confidence, scope }).strict(),
  semantic_assert: z.object({ actual: semanticActual, expected: z.string().min(1), minConfidence: confidence, minSourceConfidence: confidence, scope }).strict(),
  run: z.object({ instruction, values: z.record(z.string(),z.json()).optional(), scope, maxSteps: z.number().int().positive().optional(), maxDecisions:z.number().int().positive().optional(),decisionRetries:z.number().int().min(0).max(2).optional(),settleTimeoutMs:z.number().int().positive().optional(),timeoutMs:z.number().int().positive().optional(),expect:z.union([nativeSchemas.assert,z.array(nativeSchemas.assert).min(1)]).optional() }).strict(),
  screenshot: z.object({}).strict(),
  close: z.object({}).strict(),
};
export type CommandName = keyof typeof commandSchemas;
export type Command = { [K in CommandName]: { command: K } & z.output<(typeof commandSchemas)[K]> }[CommandName];
const descriptions: Partial<Record<CommandName, string>> = {
  goto: 'Navigate to an HTTP(S) URL. Alias for navigate.',
  navigate: 'Navigate the selected tab to an HTTP(S) URL.',
  snapshot: 'Read accessible controls and source text, with short-lived element references. No model call.',
  observe: 'Use Jev to choose one grounded action without executing it. Values are explicit named local inputs. Returns a single-use plan or null.',
  act: 'Use Jev to execute one instruction, or execute a previous planId. Literal input text belongs in named values. No automatic mutation retries.',
  extract: 'Copy source-grounded data. Use fields for scalar fields or JSON Schema for nested objects and arrays. recordsScope selects repeated DOM rows/cards. Returns data and source evidence.',
  semantic_locate: 'Use Jev to bind one caller description to a grounded current element. Returns a short-lived real ref, confidence and evidence; never a model-generated selector.',
  semantic_compare: 'Compare grounded actual evidence with caller expected meaning. Exact local equality avoids Jev; semantic outcomes include confidence, threshold and evidence.',
  semantic_assert: 'Read-only semantic assertion. Passed requires equivalent at/above threshold; different or inconclusive results are errors. Deterministic assertions remain available separately.',
  run: 'Complete a goal with supplied nested JSON inputs. Independent field judgments are batched; browser writes are serial. Saved results require readback or explicit expect assertions. Returns input coverage, effect state, usage and partial progress on errors.',
  assert: 'Deterministically assert a page/element fact with Playwright polling. Failure is an error, never a model opinion.',
  click: 'Click a snapshot ref or caller-authored Playwright selector. element is a human-readable description, not a selector. No model call.',
  type: 'Fill or type literal text into a snapshot ref or selector. submit presses Enter.',
  fill_form: 'Fill several explicit fields using refs or selectors, without a model call.',
  tabs: 'List, open, select or close tabs. The session always has a selected Page.',
  handle_dialog: 'Accept or dismiss a pending alert/confirm/prompt dialog. A prompt can receive promptText.',
  file_upload: 'Upload paths within configured file roots. Provide a file input target/ref or use a previously opened chooser.',
  downloads: 'List downloads, save one within the artifact directory, or cancel it.',
  take_screenshot: 'Capture viewport/full-page/element PNG or JPEG. Optional filename is inside the artifact directory.',
  screenshot: 'Capture a PNG of the selected viewport.',
  pdf: 'Save a PDF within the artifact directory. Chromium only.',
  evaluate: 'Run a trusted caller-authored JavaScript function in the page. Disabled unless --allow-evaluate. Never invokes Jev.',
  init_script: 'Install a trusted page init script, enabled only with --allow-evaluate.',
  storage_state: 'Save cookies and origin state into the artifact directory. Treat the result as a secret.',
  close: 'Close this browser session and its owned resources. Borrowed Page/context are not closed.',
};
export const commandDescriptions = Object.fromEntries(Object.keys(commandSchemas).map(name => [name, descriptions[name as CommandName] ?? `Execute native Playwright ${name.replaceAll('_', ' ')} on the selected browser session. No model call.`])) as Record<CommandName, string>;
export function commandReadOnly(name: CommandName): boolean {
  return ['snapshot', 'observe', 'extract', 'semantic_locate', 'semantic_compare', 'semantic_assert', 'screenshot'].includes(name) || nativeReadOnly.has(name as NativeName);
}
export function parseCommand(input: unknown): Command {
  if (typeof input !== 'object' || input === null || !('command' in input) || typeof input.command !== 'string' || !Object.hasOwn(commandSchemas, input.command))
    throw new BrowserError('INVALID_ARGUMENT', 'Unknown or missing browser command.');
  const { command, ...args } = input;
  const name = command as CommandName;
  const parsed = commandSchemas[name].safeParse(args);
  if (!parsed.success) throw new BrowserError('INVALID_ARGUMENT', `Invalid arguments for ${name}. See --help or the tool input schema.`);
  return { command: name, ...parsed.data } as Command;
}
export async function executeCommand(browser: JevBrowser, request: Command, signal?: AbortSignal): Promise<object> {
  const options = { signal, ...('scope' in request ? { scope: request.scope } : {}), ...(request.command==='act'||request.command==='observe'?{values:request.values}:{}) };
  switch (request.command) {
    case 'goto': return browser.goto(request.url, options);
    case 'snapshot': return browser.snapshot(options);
    case 'observe': return { plan: await browser.observe(request.instruction, options) };
    case 'act': return browser.act(request.planId ? { id: request.planId } : request.instruction!, options);
    case 'run': { const {command,instruction,...runOptions}=request;return browser.run(instruction,{...runOptions,signal}); }
    case 'semantic_locate': return browser.locateSemantic(request.description, { ...options, minConfidence: request.minConfidence });
    case 'semantic_compare': return browser.compareSemantic({ actual: request.actual, expected: request.expected, minConfidence: request.minConfidence, minSourceConfidence: request.minSourceConfidence }, options);
    case 'semantic_assert': return browser.assertSemantic({ actual: request.actual, expected: request.expected, minConfidence: request.minConfidence, minSourceConfidence: request.minSourceConfidence }, options);
    case 'extract': {
      let schema: z.ZodType;
      if (request.schema) {
        try { schema = z.fromJSONSchema(request.schema); }
        catch { throw new BrowserError('UNSUPPORTED_SCHEMA', 'JSON Schema could not be represented as a grounded extraction schema.'); }
      } else {
        const shape: Record<string, z.ZodType> = {};
        for (const [name, definition] of Object.entries(request.fields!)) {
          const spec = typeof definition === 'string' ? { type: definition } : definition;
          let field: z.ZodType = spec.type === 'string' ? z.string() : spec.type === 'number' ? z.number() : z.boolean();
          if (spec.description) field = field.describe(spec.description);
          if (spec.nullable) field = field.nullable();
          shape[name] = field;
        }
        schema = z.object(shape);
      }
      return browser.extract(request.instruction, schema, { ...options, recordsScope: request.recordsScope });
    }
    case 'screenshot': return { mimeType: 'image/png', data: (await browser.screenshot(options)).toString('base64') };
    case 'close': await browser.close(); return { status: 'closed' };
    default: return browser.native(request as NativeCommand, options);
  }
}
