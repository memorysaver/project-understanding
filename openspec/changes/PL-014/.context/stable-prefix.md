# Stable Prefix — PaperLens (shared Layer 1 context)

**Problem:** Researchers get more relevant papers than they can read. PaperLens
digests arXiv papers and republishes them as short posts in a voice the owner
controls. (See `product/index.yaml`.)

**Stack (fixed, scaffolded better-t-stack):**
- web: React 19 + Vite + TanStack Router
- server: Hono on Cloudflare Workers
- db: **Cloudflare D1** via Drizzle (`drizzle-orm/d1`, bound as `DB`)
- api: **oRPC** · auth: **Better Auth** · runtime: Bun + Turborepo · deploy: Alchemy

**Architecture overview:** Serverless modular monolith. The `web → api` interface
is oRPC over HTTP; reader queries are public, console mutations are auth-gated.
The `auth` module is Better Auth — owner-only console; it does NOT gate the
reader side. See `docs/technical-spec.md` and the `auth` module + `web → api`
interface in `product-context.yaml`.

**Layer 1 (what comes online):** the curation **console** — owner-only — plus the
queue-coordinated pipeline. PL-014 is the auth gate every console procedure is
built on; PL-015+ add the console procedures themselves.

**Conventions:** conventional commits; one commit per task; trunk-based on `main`;
do not modify Better Auth tables; do not stage `openspec/specs/` in feature
commits.
