#!/usr/bin/env bash
# Workspace Setup Hook — Paperlens
# Stack: TanStack Router (Vite) web + Hono/Workers server via Alchemy, bun + Turborepo.
# Called by /aep-build Phase 0 and init.sh (session recovery). Safe to run repeatedly.
# Contract: MUST write .dev-workflow/ports.env
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"   # || pwd: don't abort under set -e before git init
cd "$REPO_ROOT"

# ── Install dependencies (idempotent) ──
bun install

# ── Ports ──
# Hardcoded by the stack: Vite web = 3001 (apps/web/vite.config.ts); server = 3000
# (apps/web/.env VITE_SERVER_URL, apps/server/.env BETTER_AUTH_URL). Per-worktree port
# isolation is intentionally NOT wired — those ports live in committed config + .env, not
# env overrides — so run one workspace at a time. The lsof guard below avoids starting a
# duplicate server when one is already up (e.g. in the main checkout).
SERVER_PORT=3000
WEB_PORT=3001

# ── Write ports.env (CONTRACT — required) ──
mkdir -p .dev-workflow
cat > .dev-workflow/ports.env <<EOF
SERVER_PORT=$SERVER_PORT
WEB_PORT=$WEB_PORT
SERVER_URL=http://localhost:$SERVER_PORT
BASE_URL=http://localhost:$WEB_PORT
EOF

# ── Start dev server, best-effort (bun run dev = turbo dev = alchemy dev + Vite) ──
if ! lsof -i :"$SERVER_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  bun run dev > .dev-workflow/dev-server.log 2>&1 &
fi

# ── Seed test data if the e2e-test skill provides it ──
SEED="$REPO_ROOT/skills/e2e-test/scripts/seed.sh"
if [ -f "$SEED" ]; then bash "$SEED" || echo "WARN: seed.sh failed (continuing)"; fi

echo "Setup complete. Server: http://localhost:$SERVER_PORT  Web: http://localhost:$WEB_PORT"
