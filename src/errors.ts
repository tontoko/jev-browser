import type { RunResult, SemanticFailure } from './types.js';

/** Stable error codes are safe to expose over CLI/MCP; never include provider bodies. */
export class BrowserError extends Error {
  partial?: RunResult;
  semantic?: SemanticFailure;
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'BrowserError';
  }
}
export function publicError(error: unknown): { code: string; message: string; partial?: RunResult; semantic?: SemanticFailure } {
  if (error instanceof BrowserError) return { code: error.code, message: error.message, ...(error.partial ? { partial: error.partial } : {}), ...(error.semantic ? { semantic: error.semantic } : {}) };
  if (error instanceof Error && /Abort|Timeout/.test(error.name))
    return { code: 'CANCELLED', message: 'Operation cancelled or timed out.' };
  return { code: 'OPERATION_FAILED', message: 'Operation failed. Inspect the local browser or trace; no action was automatically retried.' };
}
