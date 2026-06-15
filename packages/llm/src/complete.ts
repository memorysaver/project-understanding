import type { CompleteArgs, CompleteJsonResult, CompleteTextResult, LlmUsage } from "./types";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { ZodType, infer as zInfer } from "zod";
import { createClient } from "./client";
import { getLlmConfig } from "./config";
import { LlmError } from "./errors";

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
 *
 * When a `schema` is supplied, structured (JSON) output is requested and the
 * response is parsed and validated against the schema; the result carries the
 * parsed `json` object instead of raw `content`. A response that cannot be
 * parsed or validated throws an `LlmError`.
 */
export async function complete<TSchema extends ZodType>(
  args: CompleteArgs<TSchema> & { schema: TSchema },
): Promise<CompleteJsonResult<zInfer<TSchema>>>;
export async function complete(
  args: CompleteArgs & { schema?: undefined },
): Promise<CompleteTextResult>;
export async function complete<TSchema extends ZodType>(
  args: CompleteArgs<TSchema>,
): Promise<CompleteTextResult | CompleteJsonResult<zInfer<TSchema>>> {
  const config = await getLlmConfig();
  const model = config.models[args.stage];
  const client = createClient(config);

  const completion = await client.chat.completions.create({
    model,
    messages: args.messages,
    ...(args.schema ? { response_format: { type: "json_object" } } : {}),
  });

  const content = completion.choices[0]?.message?.content ?? "";
  const usage = toUsage(completion.usage);

  if (args.schema) {
    const json = parseStructured(args.schema, content);
    return { json, model: completion.model, usage };
  }

  return { content, model: completion.model, usage };
}

function parseStructured<TSchema extends ZodType>(
  schema: TSchema,
  content: string,
): zInfer<TSchema> {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (cause) {
    throw new LlmError("LLM response was not valid JSON", {
      retryable: false,
      cause,
    });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new LlmError("LLM response did not match the expected schema", {
      retryable: false,
      cause: parsed.error,
    });
  }

  return parsed.data;
}
