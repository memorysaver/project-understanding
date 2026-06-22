# Stable Prefix — PaperLens (shared Layer 1 context)

**Problem:** Researchers get more relevant papers than they can read. PaperLens
digests arXiv papers and republishes them as short posts in a voice the owner
controls. (See `product/index.yaml`.)

**Stack (fixed, scaffolded better-t-stack):**
- web: React 19 + Vite + TanStack Router
- server: Hono on Cloudflare Workers
- db: **Cloudflare D1** via Drizzle (`drizzle-orm/d1`, bound as `DB`)
- api: **oRPC** · auth: **Better Auth** · runtime: Bun + Turborepo · deploy: Alchemy

**Architecture overview:** Serverless modular monolith. The ingestion pipeline
(`crawler → digestor → stylist → publisher`) is coordinated by the
`orchestrator` using **Cloudflare Queues** for stage handoffs and **D1** for
durable per-stage intermediates and state, so stages are swappable and retries
idempotent. The `server` Worker hosts the `fetch` handler (oRPC + auth), the
Queue **consumer**, and (L2) the Cron handler. See `docs/technical-spec.md` and
the `orchestrator` + `server` modules + the `ingest-pipeline` protocol in
`product-context.yaml`.

**The Workers constraint (ADR-001):** a Worker invocation cannot run the whole
chain for many papers (subrequest cap ~1000, CPU per request). Therefore **one
LLM call per queue message / stage** — each stage runs in its own invocation,
triggered by its own message. L0 (one hardcoded paper, PL-007) ran inline;
L1+ MUST use the queue.

**Paper state machine:** `discovered → digested → styled → published`, or
`failed` after N retries. The orchestrator owns transitions + enqueueing; stage
modules own only their own work and output rows.

**Conventions:** conventional commits; one commit per task; trunk-based on `main`;
do not modify Better Auth tables; do not change the D1 schema in this story; do
not stage `openspec/specs/` in feature commits.
