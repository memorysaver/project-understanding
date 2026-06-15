import type { ZodType } from "zod";

/** Pipeline stages that consume the LLM, each mapped to its own env model. */
export type LlmStage = "digest" | "style";

/** A chat message in the OpenAI-compatible shape. */
export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** Token usage returned by the provider, for cost tracking (PL-028). */
export type LlmUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/** Arguments to `complete`. */
export type CompleteArgs<TSchema extends ZodType = ZodType> = {
  stage: LlmStage;
  messages: LlmMessage[];
  /**
   * When provided, the provider is asked for structured (JSON) output and the
   * response is parsed and validated against this Zod schema before returning.
   */
  schema?: TSchema;
};

/** Result of a text completion (no schema). */
export type CompleteTextResult = {
  content: string;
  model: string;
  usage: LlmUsage;
};

/** Result of a structured completion (schema supplied). */
export type CompleteJsonResult<T> = {
  json: T;
  model: string;
  usage: LlmUsage;
};
