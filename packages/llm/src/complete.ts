import type { CompleteArgs, CompleteTextResult, LlmUsage } from "./types";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { createClient } from "./client";
import { getLlmConfig } from "./config";

function toUsage(usage: ChatCompletion["usage"]): LlmUsage {
  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}

/**
 * Send a chat completion request to OpenRouter via an OpenAI-compatible client.
 *
 * The model is resolved per `stage` from the environment — no model is
 * hardcoded. Returns the response content, the model used, and token usage.
 */
export async function complete(args: CompleteArgs): Promise<CompleteTextResult> {
  const config = await getLlmConfig();
  const model = config.models[args.stage];
  const client = createClient(config);

  const completion = await client.chat.completions.create({
    model,
    messages: args.messages,
  });

  return {
    content: completion.choices[0]?.message?.content ?? "",
    model: completion.model,
    usage: toUsage(completion.usage),
  };
}
