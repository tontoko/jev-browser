import { z } from 'zod';
import { BrowserError } from './errors.js';

const targetFields = { target: z.string().min(1).optional(), ref: z.string().min(1).optional(), element: z.string().optional(), frame: z.number().int().nonnegative().optional() };
const targetRequired = (v: { target?: string; ref?: string }) => !!(v.target || v.ref);
const targetMessage = { message: 'Provide a snapshot ref or a Playwright selector in target.' };
const button = z.enum(['left', 'middle', 'right']).optional();
const dimension = z.number().int().min(1).max(16384);
const index = z.number().int().nonnegative();
const filename = z.string().min(1).optional();
const text = z.string();
const target = z.object(targetFields).strict().refine(targetRequired, targetMessage);
export const nativeSchemas = {
  navigate: z.object({ url: z.string().min(1) }).strict(),
  navigate_back: z.object({}).strict(), navigate_forward: z.object({}).strict(), reload: z.object({}).strict(),
  click: z.object({ ...targetFields, button, doubleClick: z.boolean().optional(), modifiers: z.array(z.enum(['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift'])).optional() }).strict().refine(targetRequired, targetMessage),
  type: z.object({ ...targetFields, text, slowly: z.boolean().optional(), submit: z.boolean().optional() }).strict().refine(targetRequired, targetMessage),
  hover: target,
  drag: z.object({ startTarget: z.string().optional(), startRef: z.string().optional(), startElement: z.string().optional(), endTarget: z.string().optional(), endRef: z.string().optional(), endElement: z.string().optional(), frame: index.optional() }).strict().refine(v => !!(v.startTarget || v.startRef) && !!(v.endTarget || v.endRef), { message: 'Both drag endpoints are required.' }),
  press_key: z.object({ key: z.string().min(1), ...targetFields }).strict(),
  select_option: z.object({ ...targetFields, values: z.array(z.string()).optional(), indices: z.array(index).optional(), by: z.enum(['value', 'label']).optional() }).strict().refine(targetRequired, targetMessage).refine(v => Number(v.values !== undefined) + Number(v.indices !== undefined) === 1, { message: 'Provide values or exact observed option indices.' }),
  check: z.object({ ...targetFields, checked: z.boolean().default(true) }).strict().refine(targetRequired, targetMessage),
  fill_form: z.object({ fields: z.array(z.object({ ...targetFields, name: z.string().optional(), type: z.enum(['textbox', 'checkbox', 'radio', 'combobox', 'slider']), value: z.union([z.string(), z.boolean(), z.array(z.string())]) }).strict().refine(targetRequired, targetMessage).refine(v => v.type === 'checkbox' || v.type === 'radio' ? typeof v.value === 'boolean' : v.type === 'combobox' ? typeof v.value === 'string' || Array.isArray(v.value) : typeof v.value === 'string', { message: 'Field value must match its control type.' })).min(1) }).strict(),
  wait_for: z.object({ text: z.string().optional(), textGone: z.string().optional(), target: z.string().optional(), state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional(), time: z.number().min(0).max(300).optional() }).strict().refine(v => v.text !== undefined || v.textGone !== undefined || v.target !== undefined || v.time !== undefined, { message: 'A wait condition is required.' }),
  tabs: z.object({ action: z.enum(['list', 'new', 'select', 'close']), index: index.optional(), url: z.string().optional() }).strict().refine(v => v.action !== 'select' || v.index !== undefined, { message: 'select requires a tab index.' }),
  frames: z.object({}).strict(),
  handle_dialog: z.object({ accept: z.boolean(), promptText: z.string().optional() }).strict(),
  file_upload: z.object({ ...targetFields, paths: z.array(z.string()) }).strict(),
  downloads: z.object({ action: z.enum(['list', 'save', 'cancel']), index: index.optional(), filename }).strict().refine(v => v.action === 'list' || v.index !== undefined, { message: 'A download index is required.' }),
  take_screenshot: z.object({ ...targetFields, filename, fullPage: z.boolean().optional(), type: z.enum(['png', 'jpeg']).default('png') }).strict(),
  pdf: z.object({ filename, format: z.enum(['A4', 'Letter', 'Legal', 'A3', 'A5']).default('A4'), printBackground: z.boolean().optional() }).strict(),
  resize: z.object({ width: dimension, height: dimension }).strict(),
  console_messages: z.object({ level: z.enum(['error', 'warning', 'info', 'debug']).optional(), clear: z.boolean().optional() }).strict(),
  network_requests: z.object({ clear: z.boolean().optional() }).strict(),
  evaluate: z.object({ function: z.string().min(1), arg: z.unknown().optional(), ...targetFields }).strict(),
  init_script: z.object({ script: z.string().min(1) }).strict(),
  storage: z.object({ area: z.enum(['local', 'session']), action: z.enum(['get', 'set', 'delete', 'clear', 'list']), name: z.string().optional(), value: z.string().optional() }).strict().refine(v => ['clear', 'list'].includes(v.action) || v.name !== undefined, { message: 'A storage name is required.' }).refine(v => v.action !== 'set' || v.value !== undefined, { message: 'set requires a value.' }),
  cookies: z.object({ action: z.enum(['list', 'add', 'clear']), urls: z.array(z.string()).optional(), cookies: z.array(z.object({ name: z.string(), value: z.string(), url: z.string().optional(), domain: z.string().optional(), path: z.string().optional(), expires: z.number().optional(), httpOnly: z.boolean().optional(), secure: z.boolean().optional(), sameSite: z.enum(['Strict', 'Lax', 'None']).optional() }).strict()).optional() }).strict().refine(v => v.action !== 'add' || v.cookies !== undefined, { message: 'add requires cookies.' }),
  storage_state: z.object({ filename }).strict(),
  trace: z.object({ action: z.enum(['start', 'stop']), filename }).strict(),
  route: z.object({ action: z.enum(['fulfill', 'abort', 'remove']), pattern: z.string().min(1), status: z.number().int().min(100).max(599).optional(), body: z.string().optional(), contentType: z.string().optional() }).strict(),
  mouse: z.object({ action: z.enum(['move', 'click', 'down', 'up', 'wheel']), x: z.number().optional(), y: z.number().optional(), button, deltaX: z.number().optional(), deltaY: z.number().optional() }).strict().refine(v => !['move', 'click'].includes(v.action) || v.x !== undefined && v.y !== undefined, { message: 'Mouse position is required.' }),
  assert: z.object({ ...targetFields, property: z.enum(['visible', 'hidden', 'text', 'value', 'checked', 'count', 'url', 'title', 'enabled']), expected: z.union([z.string(), z.boolean(), z.number()]).optional() }).strict().refine(v => ['url', 'title'].includes(v.property) || targetRequired(v), targetMessage).refine(v => ['visible', 'hidden', 'enabled'].includes(v.property) || v.expected !== undefined, { message: 'An expected value is required.' }),
};
export type NativeName = keyof typeof nativeSchemas;
export type NativeCommand = { [K in NativeName]: { command: K } & z.input<(typeof nativeSchemas)[K]> }[NativeName];
export type ParsedNativeCommand = { [K in NativeName]: { command: K } & z.output<(typeof nativeSchemas)[K]> }[NativeName];
export function parseNative(input: NativeCommand): ParsedNativeCommand {
  const { command, ...args } = input;
  if (!Object.hasOwn(nativeSchemas, command)) throw new BrowserError('INVALID_ARGUMENT', 'Unknown native browser operation.');
  const result = nativeSchemas[command].safeParse(args);
  if (!result.success) throw new BrowserError('INVALID_ARGUMENT', `Invalid arguments for ${command}.`);
  return { command, ...result.data } as ParsedNativeCommand;
}
export const nativeReadOnly = new Set<NativeName>(['frames', 'console_messages', 'network_requests', 'assert', 'wait_for']);
