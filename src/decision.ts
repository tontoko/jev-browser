import { TypeSafeClient, type ChoiceQuestion, type EntryType, type Fetch, type Usage } from '@typesafe-ai/sdk';
import { z } from 'zod';
import { BrowserError } from './errors.js';

export interface DecisionRequest {
  state: EntryType;
  questions: Record<string, ChoiceQuestion>;
}
export interface DecisionResult {
  answers: Record<string, { choice: string; confidence: number }>;
  model?: string;
  models?: string[];
  usage?: Usage;
  elapsedMs?: number;
}
/** A small test seam, not a model router. Production uses JevDecisionEngine. */
export interface DecisionEngine {
  decide(request: DecisionRequest, options?: { signal?: AbortSignal; maxRetries?: number }): Promise<DecisionResult>;
}
export interface JevOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  timeoutMs?: number;
  fetch?: Fetch;
}
const choiceAnswer = z.object({ choice: z.string(), confidence: z.number().min(0).max(1) });
const wireResult = z.object({
  answers: z.record(z.string(), choiceAnswer),
  model: z.string(),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});
/** The whole-request budget shared by every decision call, measured on the wire form. */
export const DECISION_REQUEST_BYTES = 128 * 1024;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const omitMainFrame = (value: Json): void => {
  if (Array.isArray(value)) { for (const item of value) omitMainFrame(item); return; }
  if (typeof value !== 'object' || value === null) return;
  if (value.frame === 0) delete value.frame;
  for (const child of Object.values(value)) omitMainFrame(child);
};
/**
 * The form sent to Jev: `frame: 0` (the main frame) is omitted, and nothing else changes.
 * Every other field, value and key order stays exactly as built, because the model is sensitive to request shape.
 */
export function wireDecisionRequest(request: DecisionRequest): DecisionRequest {
  const copy = JSON.parse(JSON.stringify(request)) as { state: Json; questions: Record<string, { criteria?: Json }> };
  omitMainFrame(copy.state);
  for (const question of Object.values(copy.questions)) if (question.criteria !== undefined) omitMainFrame(question.criteria);
  return copy as unknown as DecisionRequest;
}
export const decisionRequestBytes = (request: DecisionRequest): number => Buffer.byteLength(JSON.stringify(wireDecisionRequest(request)));
const hostedOrigin = 'https://api.typesafe.ai';
/**
 * A Cloudflare Workers AI run URL for a System One model, e.g.
 * `https://api.cloudflare.com/client/v4/accounts/<account>/ai/run/@cf/cloudflare/clef-flash`. Clef follows the
 * System One API, but the run URL replaces the SDK's `/v1/systemone` path, the `model` field must be the model's
 * short name, and the v4 envelope wraps the System One answer in `result`.
 */
const workersAiRun = /^\/client\/v4\/accounts\/[^/]+\/ai\/run\/@cf\/[^/]+\/([^/]+)$/;
export const workersAiModel = (url: URL): string | undefined =>
  url.protocol === 'https:' && url.hostname === 'api.cloudflare.com' ? workersAiRun.exec(url.pathname)?.[1] : undefined;
/** Sends the SDK's System One request to a Workers AI run URL and hands the SDK the unwrapped `result`. */
const workersAiFetch = (runUrl: string, model: string, inner: Fetch = globalThis.fetch): Fetch =>
  (async (_input: unknown, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const response = await inner(runUrl, { ...init, body: JSON.stringify({ ...body, model }) });
    const text = await response.text();
    let envelope: unknown;
    try { envelope = JSON.parse(text); } catch { envelope = undefined; }
    const record = typeof envelope === 'object' && envelope !== null ? (envelope as { success?: unknown; result?: unknown }) : undefined;
    const headers = { 'content-type': 'application/json' };
    // A v4 error keeps its HTTP status; `success: false` on a 200 is a provider error, not an answer.
    if (!response.ok || !record || record.success === false || record.result === undefined)
      return new Response(text, { status: response.ok ? 502 : response.status, headers });
    return new Response(JSON.stringify(record.result), { status: 200, headers });
  }) as Fetch;
/** Empty or whitespace-only settings are unset, matching `.env` files that leave a key blank. */
export const setting = (value: string | undefined) => value?.trim() || undefined;
export const loopback = (host: string) => host === 'localhost' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host);

/** Hosted Jev answers an over-long request with HTTP 400 `{"detail":{"error_type":"max_tokens_exceeded"}}`. */
const tokenLimitRejection = (error: unknown): boolean => {
  const body = typeof error === 'object' && error !== null && 'body' in error ? error.body : undefined;
  const detail = typeof body === 'object' && body !== null && 'detail' in body ? body.detail : undefined;
  return typeof detail === 'object' && detail !== null && 'error_type' in detail && detail.error_type === 'max_tokens_exceeded';
};

export class JevDecisionEngine implements DecisionEngine {
  private readonly client: TypeSafeClient;
  constructor(options: JevOptions = {}) {
    const url = URL.parse(setting(options.baseURL) ?? setting(process.env.JEV_BASE_URL) ?? hostedOrigin);
    if (!url || !['http:', 'https:'].includes(url.protocol)) throw new BrowserError('CONFIG', 'The decision baseURL must be an HTTP(S) URL.');
    // Hosted keys from the environment stay with hosted Jev; another endpoint needs apiKey or JEV_ENDPOINT_API_KEY, else a keyless placeholder.
    const hosted = url.origin === hostedOrigin;
    const workersModel = workersAiModel(url);
    const apiKey = setting(options.apiKey) ?? (hosted ? setting(process.env.JEV_API_KEY) ?? setting(process.env.TYPESAFE_API_KEY) : setting(process.env.JEV_ENDPOINT_API_KEY));
    if (hosted && !apiKey) throw new BrowserError('CONFIG', 'Hosted Jev needs apiKey, JEV_API_KEY or TYPESAFE_API_KEY. A custom System One baseURL or JEV_BASE_URL needs no hosted key.');
    if (workersModel && !apiKey)
      throw new BrowserError('CONFIG', 'A Workers AI run URL needs a Cloudflare API token in apiKey or JEV_ENDPOINT_API_KEY.');
    if (apiKey && url.protocol === 'http:' && !loopback(url.hostname))
      throw new BrowserError('CONFIG', 'An API key is sent only over HTTPS or to a loopback endpoint. Use an https:// decision baseURL.');
    this.client = new TypeSafeClient({
      apiKey: apiKey ?? 'local',
      // Always explicit, so the SDK's own TYPESAFE_BASE_URL cannot redirect a hosted key.
      baseURL: workersModel ? url.origin : url.href,
      defaultModel: workersModel ?? setting(options.model) ?? setting(process.env.JEV_MODEL),
      timeout: options.timeoutMs ?? 15_000,
      retry: { maxRetries: 0 },
      logLevel: 'off',
      fetch: workersModel ? workersAiFetch(url.href, workersModel, options.fetch) : options.fetch,
    });
  }
  async decide(request: DecisionRequest, options: { signal?: AbortSignal; maxRetries?: number } = {}): Promise<DecisionResult> {
    options.signal?.throwIfAborted();
    const start = performance.now();
    let raw: unknown;
    try {
      raw = await this.client.systemOne(wireDecisionRequest(request), { signal: options.signal, retry: { maxRetries: options.maxRetries ?? 0 } });
    } catch (error) {
      if (options.signal?.aborted) throw new BrowserError('CANCELLED', 'Jev decision cancelled.', { cause: error });
      const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
      // Hosted Jev limits input tokens, not bytes, so a request under DECISION_REQUEST_BYTES can still be too large.
      if (status === 400 && tokenLimitRejection(error))
        throw new BrowserError('OBSERVATION_LIMIT', 'The decision request exceeds the Jev input token limit; no browser action was retried. Narrow scope or exclude, or lower maxElements/maxTexts/maxCandidates.', { cause: error });
      // Transport failures, 408, 429 and 5xx may succeed unchanged; the core clears this once a browser effect started.
      throw new BrowserError('PROVIDER_ERROR', `Jev request failed${status === undefined ? '' : ` (HTTP ${status})`}; no browser action was retried.`, { cause: error, retryable: status === undefined || status === 408 || status === 429 || status >= 500 });
    }
    const parsed = wireResult.safeParse(raw);
    if (!parsed.success) throw new BrowserError('INVALID_DECISION', 'Jev returned an invalid decision envelope.');
    for (const [id, question] of Object.entries(request.questions)) {
      const answer = parsed.data.answers[id];
      if (!answer || !Object.hasOwn(question.criteria, answer.choice))
        throw new BrowserError('INVALID_DECISION', 'Jev selected an unknown candidate or omitted an answer.');
    }
    return { ...parsed.data, elapsedMs: performance.now() - start };
  }
}
