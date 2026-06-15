# Stable Prefix — PaperLens (shared Layer 0 context)

**Problem:** Researchers get more relevant papers than they can read. PaperLens
digests arXiv papers and republishes them as short posts in a voice the owner
controls. (See `product/index.yaml`.)

**Stack (fixed, scaffolded better-t-stack):**
- web: React 19 + Vite + TanStack Router
- server: Hono on Cloudflare Workers
- db: **Cloudflare D1** via Drizzle (`drizzle-orm/d1`, bound as `DB`) — NOT Turso/LibSQL
- api: oRPC · auth: Better Auth · runtime: Bun + Turborepo · deploy: Alchemy

**Architecture overview:** Serverless modular monolith; pipeline stages
(crawler → digestor → stylist → publisher) decoupled via durable D1 intermediates
+ (Layer 1) Cloudflare Queues, coordinated by an orchestrator. See
`docs/technical-spec.md` (§2 domain model, §3 Paper state machine).

**Layer 0 (walking skeleton):** one hardcoded arXiv paper flows crawl → digest →
restyle (default prompt) → publish → appears in the feed. No tags, no scheduler,
no console, no auth at Layer 0.

**Conventions:** conventional commits; one commit per task; trunk-based on `main`;
do not modify Better Auth tables; do not stage `openspec/specs/` in feature
commits.
