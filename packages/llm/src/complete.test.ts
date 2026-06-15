import type { LlmConfig } from "./config";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { APIError } from "openai";
import { z } from "zod";

// --- Mocks -----------------------------------------------------------------
// The OpenAI/HTTP client and the env-backed config are both mocked so no real
// OpenRouter call is ever made and the Workers env import is never reached.

const TEST_CONFIG: LlmConfig = {
  baseURL: "https://openrouter.test/api/v1",
  apiKey: "test-key",
  models: {
    digest: "vendor/digest-model",
    style: "vendor/style-model",
  },
};

// `create` is reassigned per test to control the provider response.
let create: ReturnType<typeof mock>;

mock.module("./config", () => ({
  getLlmConfig: async (): Promise<LlmConfig> => TEST_CONFIG,
}));

mock.module("./client", () => ({
  createClient: () => ({
    chat: { completions: { create: (...args: unknown[]) => create(...args) } },
  }),
}));

// Import under test AFTER the mocks are registered.
const { complete } = await import("./complete");
const { LlmError } = await import("./errors");

function chatResponse(content: string, model = "vendor/digest-model") {
  return {
    model,
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

afterEach(() => {
  create = mock(() => {
    throw new Error("create not configured for this test");
  });
});

// --- 3.1 Contract test: result shape ---------------------------------------

describe("complete() result shape", () => {
  test("returns { content, model, usage }", async () => {
    create = mock(async () => chatResponse("hello world"));

    const result = await complete({
      stage: "digest",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.content).toBe("hello world");
    expect(result.model).toBe("vendor/digest-model");
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });
});

// --- 3.2 Per-stage model resolution (no hardcoded model) -------------------

describe("per-stage model resolution", () => {
  test("digest and style resolve to their env-configured models", async () => {
    create = mock(async (args: { model: string }) => chatResponse("ok", args.model));

    await complete({ stage: "digest", messages: [{ role: "user", content: "x" }] });
    await complete({ stage: "style", messages: [{ role: "user", content: "x" }] });

    expect(create.mock.calls[0]?.[0]).toMatchObject({ model: "vendor/digest-model" });
    expect(create.mock.calls[1]?.[0]).toMatchObject({ model: "vendor/style-model" });
  });
});

// --- 3.3 Structured output -------------------------------------------------

describe("structured output", () => {
  const schema = z.object({ title: z.string(), score: z.number() });

  test("a schema yields a parsed, validated object", async () => {
    create = mock(async () => chatResponse(JSON.stringify({ title: "Paper", score: 9 })));

    const result = await complete({
      stage: "digest",
      messages: [{ role: "user", content: "summarize" }],
      schema,
    });

    expect(result.json).toEqual({ title: "Paper", score: 9 });
    expect(result.model).toBe("vendor/digest-model");
    expect(result.usage.totalTokens).toBe(15);
  });

  test("requests JSON output when a schema is given", async () => {
    create = mock(async () => chatResponse(JSON.stringify({ title: "P", score: 1 })));

    await complete({
      stage: "digest",
      messages: [{ role: "user", content: "summarize" }],
      schema,
    });

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      response_format: { type: "json_object" },
    });
  });

  test("an invalid (schema-mismatched) response throws LlmError", async () => {
    create = mock(async () => chatResponse(JSON.stringify({ title: "Paper" })));

    const promise = complete({
      stage: "digest",
      messages: [{ role: "user", content: "summarize" }],
      schema,
    });

    await expect(promise).rejects.toBeInstanceOf(LlmError);
  });

  test("a non-JSON response throws LlmError", async () => {
    create = mock(async () => chatResponse("not json at all"));

    const promise = complete({
      stage: "digest",
      messages: [{ role: "user", content: "summarize" }],
      schema,
    });

    await expect(promise).rejects.toBeInstanceOf(LlmError);
  });
});

// --- 3.4 Typed retryable error on non-2xx ----------------------------------

describe("non-2xx provider response", () => {
  test("throws a typed, retryable LlmError carrying the status", async () => {
    create = mock(async () => {
      throw new APIError(503, undefined, "Service Unavailable", undefined);
    });

    const promise = complete({
      stage: "digest",
      messages: [{ role: "user", content: "hi" }],
    });

    await expect(promise).rejects.toBeInstanceOf(LlmError);
    const error = (await promise.catch((e: unknown) => e)) as InstanceType<typeof LlmError>;
    expect(error.status).toBe(503);
    expect(error.retryable).toBe(true);
  });
});
