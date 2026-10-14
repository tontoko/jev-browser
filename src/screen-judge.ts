import { createHash } from 'node:crypto';
import { BrowserError } from './errors.js';
import { loopback, setting, workersAiModel } from './decision.js';
import type { ScreenResult } from './screen.js';

/**
 * Opt-in itemized screen judging: one viewport capture (plus optional page text or HTML) is sent with many
 * yes/no items in ONE request to an image-capable decision model that follows the System One API with its
 * `images` extension (for example a Workers AI run URL such as `.../ai/run/@cf/<vendor>/<model>`), and every
 * item gets its own probability. An item passes when its probability is at least its threshold.
 */
export interface ScreenJudgeOptions {
  /** System One-compatible endpoint that accepts `images`: a Workers AI run URL, or an API root (POST {baseURL}/v1/systemone). HTTPS, or HTTP to loopback. */
  baseURL: string;
  /** Model short name sent as `model`. Defaults to the last path segment of a Workers AI run URL; required otherwise. */
  model?: string;
  /** Explicit credentials for this endpoint only. Environment keys are never read. */
  apiKey?: string;
  /** Default pass threshold for every item, 0..1 (default 0.5). */
  threshold?: number;
  /** Per-request limit in ms (default 30000). */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}
/** A caller adapter for another protocol or an in-process model. It must return one probability (0..1) per item id. */
export interface ScreenJudge {
  judge(input: ScreenJudgeInput, options?: { signal?: AbortSignal }): Promise<{ probabilities: Record<string, number>; model?: string; usage?: { input_tokens?: number; output_tokens?: number } }>;
}
export interface ScreenJudgeInput {
  images: { data: string; mimeType: 'image/png' }[];
  state: Record<string, unknown>;
  /** id → positive yes/no instruction ("yes" means the screen is acceptable for that item). */
  items: Record<string, string>;
}
export type ScreenJudgeItem = string | { instructions: string; threshold?: number };
export interface ScreenJudgeRequest {
  /** 1 to 64 items. Phrase each one positively, so "yes" means acceptable. */
  items: Record<string, ScreenJudgeItem>;
  /** Caller context (goal, specification, fixture facts). Sent to the judge endpoint. */
  state?: Record<string, unknown>;
  /** Overrides the configured default threshold for this request. */
  threshold?: number;
  /** Page content sent with the image: 'text' (visible text, default), 'html' (serialized DOM), or 'none'. Screen-only sessions allow only 'none'. */
  page?: 'text' | 'html' | 'none';
  /** Max characters of page content (default 30000). */
  maxPageChars?: number;
}
export interface ScreenJudgeResult {
  /** True when every item passed. */
  passed: boolean;
  failed: string[];
  items: Record<string, { probability: number; threshold: number; passed: boolean }>;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  evidence: { observationId: string; viewport: { width: number; height: number }; freshness: 'snapshot'; frames: { sha256: string; capturedAt: string }[]; page: 'text' | 'html' | 'none'; pageChars: number; elapsedMs: number };
}

const itemId = /^[A-Za-z0-9_.-]{1,100}$/;
const probability = (value: unknown, name: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new BrowserError('INVALID_ARGUMENT', `${name} must be a number from 0 to 1.`);
  return value;
};
export function validateJudgeRequest(request: ScreenJudgeRequest) {
  if (!request || typeof request !== 'object' || !request.items || typeof request.items !== 'object') throw new BrowserError('INVALID_ARGUMENT', 'screenJudge needs items.');
  const ids = Object.keys(request.items);
  if (ids.length < 1 || ids.length > 64) throw new BrowserError('INVALID_ARGUMENT', 'screenJudge takes 1 to 64 items.');
  for (const id of ids) {
    if (!itemId.test(id)) throw new BrowserError('INVALID_ARGUMENT', `Item id ${JSON.stringify(id)} may use letters, digits, '_', '.', '-' (max 100).`);
    const item = request.items[id];
    const text = typeof item === 'string' ? item : item?.instructions;
    if (typeof text !== 'string' || !text.trim()) throw new BrowserError('INVALID_ARGUMENT', `Item ${id} needs instructions.`);
    if (typeof item === 'object' && item.threshold !== undefined) probability(item.threshold, `Item ${id} threshold`);
  }
  if (request.threshold !== undefined) probability(request.threshold, 'threshold');
  if (request.page !== undefined && !['text', 'html', 'none'].includes(request.page)) throw new BrowserError('INVALID_ARGUMENT', "page must be 'text', 'html' or 'none'.");
  if (request.state !== undefined && (typeof request.state !== 'object' || request.state === null || Array.isArray(request.state))) throw new BrowserError('INVALID_ARGUMENT', 'state must be an object.');
}

/** System One-compatible image judge (Workers AI run URL or System One API root). */
export class SystemOneScreenJudge implements ScreenJudge {
  readonly defaultThreshold: number;
  readonly #apiKey?: string;
  readonly #url: string; readonly #model: string; readonly #workers: boolean;
  readonly #fetch: typeof globalThis.fetch; readonly #timeoutMs: number;
  constructor(options: ScreenJudgeOptions) {
    const url = URL.parse(setting(options?.baseURL) ?? '');
    if (!url || !['http:', 'https:'].includes(url.protocol)) throw new BrowserError('CONFIG', 'The screen judge baseURL must be an HTTP(S) URL.');
    if (url.protocol === 'http:' && !loopback(url.hostname)) throw new BrowserError('CONFIG', 'The screen judge must use HTTPS, or HTTP to a loopback host.');
    const workers = workersAiModel(url);
    const model = setting(options.model) ?? workers;
    if (!model) throw new BrowserError('CONFIG', 'The screen judge needs model unless baseURL is a Workers AI run URL.');
    this.#workers = workers !== undefined; this.#model = model;
    this.#url = workers ? url.href : new URL('v1/systemone', url.href.endsWith('/') ? url.href : `${url.href}/`).href;
    this.#apiKey = setting(options.apiKey);
    if (this.#workers && !this.#apiKey) throw new BrowserError('CONFIG', 'A Workers AI run URL needs a Cloudflare API token in apiKey.');
    this.defaultThreshold = probability(options.threshold ?? 0.5, 'threshold');
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }
  async judge(input: ScreenJudgeInput, options: { signal?: AbortSignal } = {}) {
    const questions = Object.fromEntries(Object.entries(input.items).map(([id, instructions]) => [id, { type: 'noul', instructions }]));
    const body = { model: this.#model, state: input.state, questions, images: input.images.map(image => `data:${image.mimeType};base64,${image.data}`) };
    const signal = AbortSignal.any([AbortSignal.timeout(this.#timeoutMs), ...(options.signal ? [options.signal] : [])]);
    let response: Response;
    try {
      response = await this.#fetch(this.#url, { method: 'POST', signal, headers: { 'content-type': 'application/json', ...(this.#apiKey ? { authorization: `Bearer ${this.#apiKey}` } : {}) }, body: JSON.stringify(body) });
    } catch (cause) {
      options.signal?.throwIfAborted();
      throw new BrowserError('PROVIDER_ERROR', 'The screen judge request failed.', { cause });
    }
    const text = await response.text();
    let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
    if (!response.ok || !json || json.success === false) throw new BrowserError('PROVIDER_ERROR', `The screen judge returned HTTP ${response.status}.`);
    // Workers AI (and proxies) wrap the System One answer in `result`.
    const answer = json.answers ? json : json.result;
    if (!answer?.answers) throw new BrowserError('INVALID_DECISION', 'The screen judge returned no answers.');
    const probabilities: Record<string, number> = {};
    for (const id of Object.keys(input.items)) {
      const value = answer.answers[id]?.noul;
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new BrowserError('INVALID_DECISION', `The screen judge returned no probability for item ${id}.`);
      probabilities[id] = Math.min(1, Math.max(0, value));
    }
    return { probabilities, ...(answer.model ? { model: String(answer.model) } : {}), ...(answer.usage ? { usage: answer.usage } : {}) };
  }
}
export const screenJudge = (value: ScreenJudge | ScreenJudgeOptions): ScreenJudge & { defaultThreshold?: number } =>
  typeof (value as ScreenJudge)?.judge === 'function' ? value as ScreenJudge : new SystemOneScreenJudge(value as ScreenJudgeOptions);

/** Judge one already-captured observation. Reads no page itself; pass page content explicitly. */
export async function judgeFromScreen(
  screen: ScreenResult,
  request: ScreenJudgeRequest,
  options: { judge: ScreenJudge & { defaultThreshold?: number }; page?: { kind: 'text' | 'html' | 'none'; content: string }; signal?: AbortSignal },
): Promise<ScreenJudgeResult> {
  validateJudgeRequest(request);
  options.signal?.throwIfAborted();
  const start = performance.now();
  const base = request.threshold ?? options.judge.defaultThreshold ?? 0.5;
  const items = Object.fromEntries(Object.entries(request.items).map(([id, item]) => [id, typeof item === 'string' ? item : item.instructions]));
  const thresholds = Object.fromEntries(Object.entries(request.items).map(([id, item]) => [id, typeof item === 'object' && item.threshold !== undefined ? item.threshold : base]));
  const page = options.page ?? { kind: 'none', content: '' };
  const max = request.maxPageChars ?? 30_000;
  const content = page.content.slice(0, max);
  const state = { ...(structuredClone(request.state ?? {})), ...(page.kind !== 'none' ? { page: { [page.kind]: content } } : {}) };
  const images = screen.frames.map(frame => ({ data: frame.data, mimeType: 'image/png' as const }));
  const out = await options.judge.judge({ images, state, items }, { signal: options.signal });
  options.signal?.throwIfAborted();
  const result: ScreenJudgeResult['items'] = {};
  for (const id of Object.keys(items)) {
    const p = out.probabilities?.[id];
    if (typeof p !== 'number' || !Number.isFinite(p)) throw new BrowserError('INVALID_DECISION', `The screen judge returned no probability for item ${id}.`);
    result[id] = { probability: p, threshold: thresholds[id]!, passed: p >= thresholds[id]! };
  }
  const failed = Object.keys(result).filter(id => !result[id]!.passed);
  return {
    passed: failed.length === 0, failed, items: result,
    ...(out.model ? { model: out.model } : {}), ...(out.usage ? { usage: out.usage } : {}),
    evidence: {
      observationId: screen.observationId, viewport: { ...screen.viewport }, freshness: 'snapshot',
      frames: screen.frames.map(frame => ({ capturedAt: frame.capturedAt, sha256: createHash('sha256').update(Buffer.from(frame.data, 'base64')).digest('hex') })),
      page: page.kind, pageChars: content.length, elapsedMs: performance.now() - start,
    },
  };
}
