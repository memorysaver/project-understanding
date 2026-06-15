## 1. Env config

- [ ] 1.1 Extend `packages/env/src/server.ts` with OpenRouter settings: base URL,
  API key, and per-stage model ids (e.g. digest model, style model). Validate them
  with the project's env schema convention.

## 2. llm module

- [ ] 2.1 Create `packages/llm` package (package.json, tsconfig, exports) following
  the monorepo's `@paperlens/*` package conventions.
- [ ] 2.2 Implement `complete({ stage, messages, schema? })` using an
  OpenAI-compatible client pointed at OpenRouter; resolve the model from env by
  stage; return `{ content | json, model, usage }`.
- [ ] 2.3 When `schema` is provided, request structured output and return the
  parsed, schema-validated object.
- [ ] 2.4 On non-2xx, throw a typed error (e.g. `LlmError`) carrying status, so
  callers can apply backoff/retry.

## 3. Verification

- [ ] 3.1 Contract test: `complete` returns `{ content/json, model, usage }` shape
  (mock the HTTP client).
- [ ] 3.2 Unit test: stage `digest` vs `style` resolve to their env-configured
  models (no hardcoded model).
- [ ] 3.3 Unit test: a `schema` argument yields a parsed object; an invalid
  response throws.
- [ ] 3.4 Unit test: a non-2xx response throws the typed retryable error.
