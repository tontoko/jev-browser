import { z } from 'zod';
import type { JevBrowser } from './browser.js';
import { BrowserError } from './errors.js';

const scope = z.string().min(1).optional();
const instruction = z.string().min(1);
const values = z.record(z.string().min(1), z.string()).optional();
const fieldType = z.enum(['string', 'number', 'boolean']);
const field = z.union([fieldType, z.object({ type: fieldType, description: z.string().optional(), nullable: z.boolean().optional() }).strict()]);
export const commandSchemas = {
  goto: z.object({ url: z.url() }).strict(),
  snapshot: z.object({ scope }).strict(),
  observe: z.object({ instruction, values, scope }).strict(),
  act: z.object({ instruction: instruction.optional(), planId: z.string().min(1).optional(), values, scope }).strict()
    .refine(v => Number(v.instruction !== undefined) + Number(v.planId !== undefined) === 1, { message: 'Provide exactly one of instruction or planId.' }),
  extract: z.object({ instruction, fields: z.record(z.string().min(1), field), scope }).strict(),
  run: z.object({ instruction, values, scope, maxSteps: z.number().int().positive().optional() }).strict(),
  screenshot: z.object({}).strict(),
};
export type CommandName = keyof typeof commandSchemas;
export type Command = { [K in CommandName]: { command: K } & z.output<(typeof commandSchemas)[K]> }[CommandName];
export const commandDescriptions: Record<CommandName, string> = {
  goto: 'Navigate this session to an HTTP(S) URL.',
  snapshot: 'Read accessible controls and grounded page text. CSS scope is optional. Does not call Jev.',
  observe: 'Use Jev to select one grounded action without executing it. Returns a single-use plan. Values are explicit named inputs.',
  act: 'Execute one instruction or a previous planId. Never automatically retries a browser mutation.',
  extract: 'Copy observed scalar fields with source evidence. Fields are string/number/boolean, optionally described or nullable. No generated facts.',
  run: 'Attempt a bounded sequence of grounded actions. Model completion is unverified, not a deterministic test assertion.',
  screenshot: 'Capture a PNG of the current viewport. It may contain sensitive page content.',
};
export function parseCommand(input: unknown): Command {
  if (typeof input !== 'object' || input === null || !('command' in input) || typeof input.command !== 'string' || !Object.hasOwn(commandSchemas, input.command))
    throw new BrowserError('INVALID_ARGUMENT', 'Unknown or missing browser command.');
  const { command, ...args } = input;
  const name = command as CommandName;
  const parsed = commandSchemas[name].safeParse(args);
  if (!parsed.success) throw new BrowserError('INVALID_ARGUMENT', `Invalid arguments for ${name}. See --help.`);
  return { command: name, ...parsed.data } as Command;
}
export async function executeCommand(browser: JevBrowser, request: Command, signal?: AbortSignal): Promise<object> {
  const options = { signal, ...('scope' in request ? { scope: request.scope } : {}), ...('values' in request ? { values: request.values } : {}) };
  switch (request.command) {
    case 'goto': return browser.goto(request.url, options);
    case 'snapshot': return browser.snapshot(options);
    case 'observe': return { plan: await browser.observe(request.instruction, options) };
    case 'act': return browser.act(request.planId ? { id: request.planId } : request.instruction!, options);
    case 'run': return browser.run(request.instruction, { ...options, maxSteps: request.maxSteps });
    case 'extract': {
      const shape: Record<string, z.ZodType> = {};
      for (const [name, definition] of Object.entries(request.fields)) {
        const spec = typeof definition === 'string' ? { type: definition } : definition;
        let schema: z.ZodType = spec.type === 'string' ? z.string() : spec.type === 'number' ? z.number() : z.boolean();
        if (spec.description) schema = schema.describe(spec.description);
        if (spec.nullable) schema = schema.nullable();
        shape[name] = schema;
      }
      return browser.extract(request.instruction, z.object(shape), options);
    }
    case 'screenshot': return { mimeType: 'image/png', data: (await browser.screenshot(options)).toString('base64') };
  }
}
