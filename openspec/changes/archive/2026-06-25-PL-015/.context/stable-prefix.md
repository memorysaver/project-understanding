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
is oRPC over HTTP; reader queries (`listPosts`/`getPost`) are public, console
mutations are **auth-gated**. The console gate is `protectedProcedure`
(PL-014, in `packages/api/src/index.ts`); reader procedures use `publicProcedure`.

**Layer 1 — define-voice:** the owner edits the single active StylePrompt that the
stylist uses to rewrite every paper. PL-015 is the auth-gated read/update of that
prompt; the console editor UI lands later (web).

**Conventions:** conventional commits; one commit per task; trunk-based on `main`;
do not modify Better Auth tables; do not stage `openspec/specs/` in feature
commits; non-JS-only commits use `git commit --no-verify` (oxlint pre-commit).
