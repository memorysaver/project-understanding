import type { LlmConfig } from "./config";
import OpenAI from "openai";

/**
 * Create an OpenAI-compatible client pointed at OpenRouter.
 *
 * Provider is swappable behind this one function: only the base URL and key
 * differ from the OpenAI default. Isolated in its own module so tests can mock
 * the client without a real network call.
 */
export function createClient(config: LlmConfig): OpenAI {
  return new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });
}
