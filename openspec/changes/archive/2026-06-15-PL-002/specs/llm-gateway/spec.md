## ADDED Requirements

### Requirement: LLM completion via OpenRouter
The system SHALL provide a `complete({ stage, messages, schema? })` function that
sends a chat completion request to OpenRouter through an OpenAI-compatible client
and returns the model's response.

#### Scenario: Returns content, model, and usage
- **WHEN** `complete` is called with a stage and messages and the provider returns
  a successful response
- **THEN** it returns the response content, the model used, and token usage

### Requirement: Per-stage model selection from environment
The system SHALL select the model per stage from environment configuration, with
the OpenRouter base URL and API key also read from the environment, and SHALL NOT
hardcode any model id.

#### Scenario: Different stages resolve to their configured models
- **WHEN** `complete` is called with stage `digest` and again with stage `style`
- **THEN** each request uses the model configured in the environment for that stage

### Requirement: Structured output
The system SHALL, when a `schema` is supplied, request structured output and
return the parsed object validated against that schema.

#### Scenario: Schema produces a parsed object
- **WHEN** `complete` is called with a `schema`
- **THEN** the return value includes the parsed JSON object conforming to the schema

### Requirement: Typed error on provider failure
The system SHALL throw a typed error on a non-2xx provider response so callers can
apply backoff/retry.

#### Scenario: Non-2xx response throws a retryable error
- **WHEN** OpenRouter responds with a non-2xx status
- **THEN** `complete` throws a typed error that callers can detect and retry with backoff
