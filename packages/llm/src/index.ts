// @paperlens/llm — provider-agnostic LLM access boundary for PaperLens.
// An OpenAI-compatible client pointed at OpenRouter, with per-stage model
// selection, structured output, and usage reporting. See docs/technical-spec.md
// §1 and §4.4.
export { complete } from "./complete";
export type {
  CompleteArgs,
  CompleteJsonResult,
  CompleteTextResult,
  LlmMessage,
  LlmStage,
  LlmUsage,
} from "./types";
