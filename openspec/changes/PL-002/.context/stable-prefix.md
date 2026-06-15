# Stable Prefix — PaperLens (shared Layer 0 context)

**Problem:** PaperLens digests arXiv papers and republishes them as short posts in
an owner-controlled voice. (See `product/index.yaml`.)

**Stack (fixed):** React 19 + Vite + TanStack Router (web); Hono on Cloudflare
Workers (server); Cloudflare D1 via Drizzle (db); oRPC (api); Better Auth; Bun +
Turborepo; Alchemy deploy. **LLM via OpenRouter** (OpenAI-compatible), behind an
`llm` module, models swappable per stage via env.

**Architecture:** Serverless modular monolith; pipeline stages (crawler → digestor
→ stylist → publisher) decoupled via durable D1 intermediates + (Layer 1) Queues.
Digestor + Stylist call `llm.complete`. See `docs/technical-spec.md` §1, §4.4.

**Conventions:** conventional commits; one commit per task; trunk-based on `main`;
match existing `@paperlens/*` package conventions; secrets via Workers secrets,
never committed.
