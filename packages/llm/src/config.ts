import type { LlmStage } from "./types";

/**
 * Resolved OpenRouter configuration, read from the environment.
 *
 * The base URL and API key, plus one model id per pipeline stage, all come from
 * env — no model is hardcoded. See packages/infra/alchemy.run.ts for the server
 * Worker bindings.
 */
export type LlmConfig = {
  baseURL: string;
  apiKey: string;
  models: Record<LlmStage, string>;
};

/**
 * Read the OpenRouter config from the environment.
 *
 * `env` is imported lazily from `@paperlens/env/server` (which binds to
 * `cloudflare:workers` at runtime) so this module can be mocked in tests
 * without pulling the Workers runtime.
 */
export async function getLlmConfig(): Promise<LlmConfig> {
  const { env } = await import("@paperlens/env/server");

  return {
    baseURL: env.OPENROUTER_BASE_URL,
    apiKey: env.OPENROUTER_API_KEY,
    models: {
      digest: env.OPENROUTER_MODEL_DIGEST,
      style: env.OPENROUTER_MODEL_STYLE,
    },
  };
}
