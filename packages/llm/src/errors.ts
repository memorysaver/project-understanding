/**
 * Typed error thrown by the llm module.
 *
 * Carries the provider HTTP `status` (when the failure came from a non-2xx
 * response) and a `retryable` flag so callers — the orchestrator/queue
 * (PL-018/PL-025) — can apply backoff/retry. This module does no retrying
 * itself; it only signals that a retry is appropriate.
 */
export class LlmError extends Error {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; retryable: boolean; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "LlmError";
    this.status = options.status;
    this.retryable = options.retryable;
  }
}
