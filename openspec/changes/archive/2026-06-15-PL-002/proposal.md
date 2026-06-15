## Why

The Digestor and Stylist both call an LLM, and the owner wants to vary models per
stage via their OpenRouter account (a cheaper model for digesting, a stronger one
for styling). Isolating LLM access behind one small module gives a single place
for per-stage model selection, structured output, token-usage capture, and a
swappable provider boundary. This is story PL-002 — a Layer 0 Wave 1
`shared_enabler`, parallel to and independent of PL-001.

## What Changes

- Add a `packages/llm` module exposing `complete({ stage, messages, schema? })`
  that calls **OpenRouter** via an OpenAI-compatible client.
- Select the model per stage (e.g. `digest`, `style`) from environment config; the
  base URL and API key also come from env. No model is hardcoded.
- Support structured output (return parsed JSON when a `schema` is given) and
  return token `usage` for cost tracking.
- On a non-2xx response, throw a typed error suitable for backoff/retry.
- Extend `packages/env` with the OpenRouter + per-stage model settings.

## Capabilities

### New Capabilities
- `llm-gateway`: the provider-agnostic LLM access boundary for PaperLens — an
  OpenAI-compatible client pointed at OpenRouter, per-stage model selection,
  structured output, and usage reporting.

### Modified Capabilities
<!-- none -->

## Impact

- `packages/llm` — new module (`complete()`), with contract tests.
- `packages/env` — add OpenRouter base URL/key + per-stage model env vars.
- Downstream: unblocks PL-004 (digestor) and PL-005 (stylist), which consume
  `llm.complete`.
- No DB/API/UI changes in this story.
