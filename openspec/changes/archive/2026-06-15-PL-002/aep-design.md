## Context

The PaperLens pipeline's Digestor (PL-004) and Stylist (PL-005) need LLM access.
The owner uses OpenRouter (OpenAI-compatible API) and wants to vary models per
stage. This change adds a thin `packages/llm` boundary so stages depend on `llm`,
not on a provider SDK. See `docs/technical-spec.md` §1 (the `llm` module) and
`architecture.modules[llm]` in `product-context.yaml`.

## Goals / Non-Goals

**Goals:**
- One `complete({ stage, messages, schema? })` entry point.
- Per-stage model + base URL + key from env; structured output; usage reporting.
- Typed errors for retry.

**Non-Goals:**
- No digest/style business logic (PL-004/PL-005 own that).
- No retry/backoff orchestration here (the orchestrator/queue owns retries,
  PL-018/PL-025); this module only throws a typed, retryable error.
- No streaming in this story.

## Decisions

- **OpenAI-compatible client pointed at OpenRouter** — base URL + API key from env.
  Keeps the provider swappable behind one module.
- **Per-stage model from env** — e.g. `OPENROUTER_MODEL_DIGEST`,
  `OPENROUTER_MODEL_STYLE` (exact names per `packages/env` convention). No
  hardcoded model.
- **Structured output via `schema`** — when provided, request JSON output and
  validate/parse before returning.
- **Return `usage`** — token counts flow to cost tracking (PL-028) later.
- **Secrets** — OpenRouter key is a Cloudflare Workers secret; never committed.

## Risks / Trade-offs

- OpenRouter model availability/naming varies; keep model ids in env so they can
  change without code edits.
- Structured-output support depends on the chosen model; validate and fail with a
  typed error if the response isn't parseable.
