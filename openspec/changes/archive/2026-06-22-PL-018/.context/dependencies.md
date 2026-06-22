# Dependencies — PL-018

**Upstream stories (all merged):** PL-003 (crawler), PL-004 (digestor), PL-005
(stylist), PL-006 (publisher) — plus PL-001 (persistence) and PL-002 (llm)
transitively. PL-018 wires these existing stage entry points onto the queue; it
does **not** change their internals or the D1 schema.

**Stage entry points consumed (signatures from the merged capability specs):**
- `crawler.fetchById({ id, db, fetcher? })` — persists a `Paper(status=discovered)`,
  dedup by `arxiv_id` (`ON CONFLICT DO NOTHING`). Used by the `discover` handler
  to enumerate/persist new papers.
- `digestor.run` — loads the Paper, fetches full text, **one** `llm.complete`,
  persists the `Digest`, advances `discovered → digested`. Rethrows on LLM
  failure leaving the Paper untouched (no partial advance).
- `stylist.run` — loads the `Digest` + active StylePrompt, **one** `llm.complete`,
  returns the styled body (+ style_prompt_id, digest_id, model), advances
  `digested → styled`. Throws on an empty body.
- `publisher.publish` — assembles + persists a `Post(status=published)` (title,
  sanitized body, citation, source link), advances `styled → published`, stamps
  `published_at`.

**db accessors consumed (PL-001):** typed Drizzle accessors for Paper / Digest /
Post / Run; the `Paper.status` enum (`discovered|digested|styled|published|failed`)
and the `Run` table (trigger, status, stats JSON) already exist.

> The downstream stage modules already advance their own `Paper.status` on
> success. The orchestrator drives the *transitions between* stages (enqueue the
> next message), owns the failure transition (`→ failed`) and the
> resume/idempotency guard — it does not re-implement the per-stage advance.

**Queue binding (new for this story):** a pipeline Queue producer (orchestrator
sends) + consumer (server `queue()` handler), added to the server wrangler
config. Message shape: `{ type, arxiv_id?, runId }`.

**Files this story owns:**
- `packages/orchestrator/src/index.ts` — `enqueueDiscovery` + per-stage dispatch
  (replaces `runOnce`).
- `apps/server/src/index.ts` — `queue()` consumer (replaces `POST /dev/run-once`).

**Downstream consumers (build on `enqueueDiscovery` + the dispatch):**
- PL-019 — real arXiv batch discovery + dedup in the crawler (the `discover` fan-out).
- PL-020 — auth-gated `triggerRun()` oRPC procedure + console button.
- PL-024 — `scheduled()` Cron producer + retry/backoff escalation + owner alerting.
- PL-031 — abstract-only deferral: re-queue with backoff until full text is available.
