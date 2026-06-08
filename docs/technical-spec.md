# PaperLens — Technical Specification

Companion to `product/index.yaml` (product framing) and the `architecture` section of
`product-context.yaml` (system map). This document specifies HOW the module connections behave
under all conditions: success, failure, timeout, retry. It exists because PaperLens crosses the
complexity threshold — a multi-step queue protocol, a `Paper` state machine, distinct failure
classes with different recovery, and trust boundaries that cross module lines.

> Conventions: **Important boundary** = where one responsibility stops; **Important nuance** =
> easy-to-miss detail; **Important constraint** = hard limit shaping design.

---

## 1. Architecture overview

Serverless modular monolith on **Cloudflare Workers**. The reader/console UI (`web`) talks to a
Hono Worker (`server`) over **oRPC** (`api`); the Worker also hosts the **Queue consumers** and
the **Cron handler**. The ingestion pipeline (crawler → digestor → stylist → publisher) is
coordinated by `orchestrator` using **Cloudflare Queues** for stage handoffs and **Cloudflare
D1** for durable per-stage intermediates and state. The `llm` module wraps OpenRouter
(OpenAI-compatible) so models are swappable per stage.

> **Important constraint:** A Worker invocation bills CPU time, not wall-clock — a long LLM
> `fetch` is mostly idle I/O and is fine. The real limit is the *number of stages* (and
> subrequests, cap 1000) per invocation. Therefore: **one LLM call per queue message / stage.**
> Layer 0 (one hardcoded paper) may run the stages inline; Layer 1+ MUST use the queue.

---

## 2. Domain model & persistence (D1)

All persistence is Cloudflare D1 via Drizzle (`db` module). Identifiers and invariants:

- **Paper** — `arxiv_id` TEXT PRIMARY KEY (or UNIQUE). Fields: title, authors (JSON), abstract,
  source_url, full_text_url, pdf_url, `status` enum, discovered_at, updated_at.
  - **Invariant:** `arxiv_id` is the dedup key. Inserts use `INSERT ... ON CONFLICT DO NOTHING`.
- **Digest** — id, paper_id → Paper, contributions (JSON), methods (JSON), results (JSON),
  raw_json, model, created_at. **Invariant:** at most one current Digest per Paper.
- **StylePrompt** — id, content, is_active (bool), created_at, updated_at.
  - **Invariant (MVP):** exactly one row with `is_active = true`. Updating the active prompt is a
    transactional flip.
- **Post** — id, paper_id, digest_id, style_prompt_id, title, body, citation, tags (JSON, null at
  L0), `status` enum (published | unpublished | draft), published_at, model, created_at.
  - **Invariant:** a `published` Post has non-null published_at.
- **Run** — id, trigger (manual | cron), status (running | done | failed), started_at,
  finished_at, stats (JSON: discovered/digested/styled/published/failed counts).

> **Important nuance:** Each pipeline stage reads its input from D1 and writes its output to D1
> *before* enqueuing the next stage. This is what makes retries idempotent and stages swappable.

---

## 3. Paper state machine

```
discovered ──digest──▶ digested ──style──▶ styled ──publish──▶ published
     │                    │                   │
     └────────────────────┴───────────────────┴──▶ failed (after N retries on a stage)
```

- Transitions are driven by `orchestrator` via one Queue message per (paper, next-stage).
- A stage is a pure function of its input intermediate; re-running a stage on the same Paper is
  idempotent (overwrites its own output, re-advances status only if not already past).
- `failed` is terminal until a human resets it; `published` is terminal-happy (owner may move it
  to `unpublished` from the console).

> **Important boundary:** `orchestrator` owns state transitions and enqueueing. Stage modules
> (crawler/digestor/stylist/publisher) own *their* work and their own output rows — they never
> advance another stage's state.

---

## 4. Interface contracts

### 4.1 web → api (oRPC)
- **Reader (public, no auth):**
  - `listPosts({ cursor?, limit? }) -> { posts: PostSummary[], nextCursor? }` — published only,
    reverse-chronological.
  - `getPost({ id }) -> Post` — 404 if not published.
- **Console (auth-gated, owner only):**
  - `getActivePrompt() -> StylePrompt`
  - `updateActivePrompt({ content }) -> StylePrompt`
  - `triggerRun() -> { runId }` — enqueues a producer message (manual run).
  - `previewRewrite({ promptContent, paperId }) -> { body }` *(Layer 1.5)* — runs stylist on an
    existing Digest without persisting a Post.
  - `setPostStatus({ id, status }) -> Post` — unpublish/republish.
- **Error contract:** unauthorized console calls → 401; not-found → 404; validation → 400 with a
  field-level message. Reader calls never leak unpublished content.

### 4.2 api → orchestrator
- `triggerRun()` and the Cron handler both call `orchestrator.enqueueDiscovery(trigger)`.
- **Boundary:** `api` does no pipeline work; it only enqueues and reads results from `db`.

### 4.3 orchestrator → stage modules (Cloudflare Queue)
- Single queue (or one per stage) carrying `{ type: "digest"|"style"|"publish", arxiv_id, runId }`.
- Consumer (in `server`) dispatches to the matching stage module.
- See §5 for the protocol sequence.

### 4.4 digestor/stylist → llm
- `llm.complete({ stage, messages, schema? }) -> { content | json, model, usage }`.
- Reads base URL (OpenRouter), API key, and per-stage model from env. `schema` enables structured
  output (digest JSON). Returns token usage for cost tracking.

### 4.5 crawler → arXiv (third party)
- arXiv API/Atom for discovery + metadata; full text via arXiv HTML/LaTeX source (preferred) or
  offloaded PDF extraction. **Constraint:** ~1 request / 3s, custom User-Agent.

---

## 5. Pipeline protocol sequence

**Trigger:** manual `triggerRun()` (L1) or Cron (L2) → `orchestrator.enqueueDiscovery`.

1. **Discovery message** → `crawler`: query arXiv for new papers, `INSERT ... ON CONFLICT DO
   NOTHING` each as `Paper(status=discovered)`, then enqueue one `digest` message per *new* paper.
2. **digest message** → `digestor`: load Paper, fetch full text, call `llm.complete` (structured
   digest), write `Digest`, set `status=digested`, enqueue `style`.
3. **style message** → `stylist`: load Digest + active StylePrompt, call `llm.complete`, write
   styled body, set `status=styled`, enqueue `publish`.
4. **publish message** → `publisher`: assemble + persist `Post(status=published)`, set Paper
   `status=published`.

- **Timeout behavior:** a stage that exceeds its budget throws; the Queue redelivers (backoff).
- **Error behavior:** after `max_retries` on a stage, set Paper `status=failed`, record the
  failure, and (per failure class) escalate to the owner.

> **Important nuance:** the Discovery step is the only fan-out point. Everything downstream is
> one-paper-per-message, keeping each invocation within CPU/subrequest limits.

---

## 6. Failure classes & recovery

| Class | Detection | Recovery | Escalation |
|---|---|---|---|
| Source (arXiv) down / rate-limited | HTTP status, schema validation | Skip tick, retry next cadence; honor 1 req/3s | Alert after 3 consecutive |
| LLM (OpenRouter) timeout / invalid output | HTTP status, output-schema validation | Backoff retry; Paper stays at current stage | Mark `failed` + alert after N |
| Unfaithful digest (hallucination) | Digest cites sections; blind spot-check; optional grounding | Owner unpublishes/edits; feeds faithfulness gate | Halt auto-publish if rate > gate |
| Duplicate paper | `arxiv_id` UNIQUE | `ON CONFLICT DO NOTHING` | none |
| Partial pipeline failure | stage status not advanced | Queue redelivers from last good intermediate | Alert after repeated same-paper failures |

**Degraded operation:** if LLM/source is down, no new posts are produced, but the reader feed and
article pages remain fully readable (static reads from D1).

---

## 7. Security & trust boundaries

- **Owner** = trusted, authenticated via Better Auth (console only).
- **Readers** = untrusted, read-only; reader oRPC procedures never return unpublished content.
- **External content** (arXiv text, LLM output) = untrusted input. **Important boundary:** LLM
  output is sanitized before rendering (no raw HTML injection into posts).
- **Secrets** (OpenRouter key, DB creds, auth secret) live in Cloudflare Workers secrets via
  Alchemy/wrangler — never committed.
- **Open item:** Better Auth cross-subdomain cookies on `*.workers.dev` — use a custom domain or
  enable `crossSubDomainCookies`/`cookieCache` before deploy.

---

## 8. Deployment & runtime bindings

- **server** (Cloudflare Worker): `fetch` handler (oRPC + auth), Queue consumer(s), Cron handler.
- **Bindings:** `DB` (D1), pipeline Queue(s), Cron trigger (L2), optional R2 for large full-text
  blobs, secrets (OpenRouter, auth).
- **web:** static assets on Cloudflare. **Deploy:** Alchemy (infrastructure-as-TypeScript).
- **Layering note:** L0 may run the pipeline inline (one hardcoded paper, dev-triggered); L1
  introduces the Queue + state machine + manual trigger; L2 adds the Cron producer + retries.
