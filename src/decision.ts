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

export class JevDecisionEngine implements DecisionEngine {
  private readonly client: TypeSafeClient;
  constructor(options: JevOptions = {}) {
    const apiKey = options.apiKey ?? process.env.JEV_API_KEY ?? process.env.TYPESAFE_API_KEY;
    if (!apiKey) throw new BrowserError('CONFIG', 'Set JEV_API_KEY or TYPESAFE_API_KEY.');
    this.client = new TypeSafeClient({
      apiKey,
      baseURL: options.baseURL ?? process.env.JEV_BASE_URL,
      defaultModel: options.model ?? process.env.JEV_MODEL,
      timeout: options.timeoutMs ?? 15_000,
      retry: { maxRetries: 0 },
      logLevel: 'off',
      fetch: options.fetch,
    });
  }
  async decide(request: DecisionRequest, options: { signal?: AbortSignal; maxRetries?: number } = {}): Promise<DecisionResult> {
    options.signal?.throwIfAborted();
    const start = performance.now();
    let raw: unknown;
    try {
      raw = await this.client.systemOne(request, { signal: options.signal, retry: { maxRetries: options.maxRetries ?? 0 } });
    } catch (error) {
      if (options.signal?.aborted) throw new BrowserError('CANCELLED', 'Jev decision cancelled.');
      const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
        ? ` (HTTP ${error.status})` : '';
      throw new BrowserError('PROVIDER_ERROR', `Jev request failed${status}; no browser action was retried.`);
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
