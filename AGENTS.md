# Agent behavioral guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# AGENTS.md

Guidance for AI coding agents working in this repository.

## AEP Workflow

This project uses the Agentic Engineering Patterns (AEP) skills — a spec-driven, multi-agent
feature lifecycle in `.claude/skills/` and/or `.agents/skills/`, pinned via `skills-lock.json`.
The skills are self-describing; start with `aep-onboard`. Upgrade by re-running
`npx skills add memorysaver/agentic-engineering-patterns@<newtag>` once per agent.

## Memory & Learning Loop

This project layers `project-memory` + `memory-forge` (installed in `.claude/skills/` and
`.agents/skills/`) over AEP's native lessons loop — it does not replace it. AEP still **captures**
(`/build` → `.dev-workflow/lessons.md`), **archives** (`/wrap` → `lessons-learned/`), and
**recalls** (`/launch`). The supplement adds, on top:

- **`project-memory`** — semantic recall at `/dispatch` (query `project-memory/` before picking a
  story), and at `/wrap` persist the just-archived lesson into `project-memory/lesson-learned/` for
  qmd-backed cross-session search (collection `project-understanding-memory`).
- **`memory-forge`** — at `/reflect` or before a PR, distill settled lessons (≥7 days old, once ≥3
  have accrued) into reusable skills the next agent auto-loads.
