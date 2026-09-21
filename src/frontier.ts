import { BrowserError } from './errors.js';
import type { DecisionEngine, DecisionRequest, DecisionResult } from './decision.js';

export interface DecisionUsage {
  requests: number;
  questions: number;
  serialDecisionDepth: number;
  inputTokens: number;
  outputTokens: number;
  providerMs: number;
}

export const emptyDecisionUsage = (): DecisionUsage => ({
  requests: 0,
  questions: 0,
  serialDecisionDepth: 0,
  inputTokens: 0,
  outputTokens: 0,
  providerMs: 0,
});

const MAX_QUESTIONS = 64;
const MAX_BYTES = 128 * 1024;

type StateForQuestions = (questions: DecisionRequest['questions']) => DecisionRequest['state'];

function chunks(request: DecisionRequest, stateForQuestions?: StateForQuestions): DecisionRequest[] {
  const entries = Object.entries(request.questions);
  const result: DecisionRequest[] = [];
  for (let offset = 0; offset < entries.length;) {
    let count = Math.min(MAX_QUESTIONS, entries.length - offset);
    let candidate: DecisionRequest | undefined;
    while (count >= 1) {
      const questions = Object.fromEntries(entries.slice(offset, offset + count));
      candidate = { state: stateForQuestions ? stateForQuestions(questions) : request.state, questions };
      if (Buffer.byteLength(JSON.stringify(candidate)) <= MAX_BYTES) break;
      if (count === 1) throw new BrowserError('OBSERVATION_LIMIT', 'A decision question exceeds the 128 KiB request budget. Narrow the semantic scope.');
      count = Math.max(1, Math.floor(count / 2));
    }
    result.push(candidate!);
    offset += count;
  }
  return result;
}

export async function decideFrontier(
  engine: DecisionEngine,
  request: DecisionRequest,
  options: { signal: AbortSignal; usage: DecisionUsage; maxRequests?: number; maxRetries?: number; stateForQuestions?: StateForQuestions },
): Promise<DecisionResult> {
  const entries = Object.entries(request.questions);
  if (!entries.length) return { answers: {} };
  options.signal.throwIfAborted();
  const parts = chunks(request, options.stateForQuestions);
  if (options.maxRequests !== undefined && options.usage.requests + parts.length > options.maxRequests)
    throw new BrowserError('DECISION_LIMIT', 'The operation exhausted its decision request budget.');

  options.usage.serialDecisionDepth++;
  const started = performance.now();
  const stop = new AbortController();
  const signal = AbortSignal.any([options.signal, stop.signal]);
  // Dispatch every independent question. A failed/invalid response cancels only
  // this wave; no model decisions are replaced by local business rules.
  const tasks = parts.map(async part => {
    try {
      signal.throwIfAborted();
      options.usage.requests++;
      options.usage.questions += Object.keys(part.questions).length;
      const result = await engine.decide(part, { signal, maxRetries: options.maxRetries });
      // A received response consumed work even if a sibling fails or its answers
      // are invalid. Unreported server-side work cannot be inferred here.
      options.usage.inputTokens += result.usage?.input_tokens ?? 0;
      options.usage.outputTokens += result.usage?.output_tokens ?? 0;
      for (const [id, question] of Object.entries(part.questions)) {
        const answer = result.answers?.[id];
        if (!answer || !Object.hasOwn(question.criteria, answer.choice) || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)
          throw new BrowserError('INVALID_DECISION', 'A frontier decision was missing, invalid, or outside its offered candidates.');
      }
      return result;
    } catch (error) {
      stop.abort(error);
      throw error;
    }
  });
  let results: DecisionResult[];
  try {
    results = await Promise.all(tasks);
    options.signal.throwIfAborted();
  } catch (error) {
    stop.abort(error);
    await Promise.allSettled(tasks);
    throw error;
  } finally {
    options.usage.providerMs += performance.now() - started;
  }

  const answers: DecisionResult['answers'] = {};
  const models = [...new Set(results.flatMap(result => result.models ?? (result.model ? [result.model] : [])))];
  const model = models.length === 1 && results.every(result => result.model === models[0]) ? models[0] : undefined;
  for (const [index, part] of parts.entries())
    for (const id of Object.keys(part.questions)) answers[id] = results[index]!.answers[id]!;
  return {
    answers,
    ...(model ? { model } : {}),
    ...(models.length ? { models } : {}),
    usage: {
      input_tokens: results.reduce((sum, result) => sum + (result.usage?.input_tokens ?? 0), 0),
      output_tokens: results.reduce((sum, result) => sum + (result.usage?.output_tokens ?? 0), 0),
    },
    elapsedMs: performance.now() - started,
  };
}
