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

## AEP Workflow

This project follows the [Agentic Engineering Patterns](https://github.com/memorysaver/agentic-engineering-patterns)
(AEP) workflow — a spec-driven, multi-agent feature lifecycle. Its `aep-*` skills (in
`.claude/skills/` and `.agents/skills/`, pinned at **v1.6.0**) are self-describing; use them for
feature work and start with **`aep-onboard`** for the mental model.

All AEP commands carry the `aep-` prefix — invoke `/aep-dispatch`, `/aep-launch`, `/aep-build`,
`/aep-wrap`, `/aep-autopilot`, etc. (never the bare `/launch` or `/build` the upstream templates
show, including in bootstrap prompts sent to workspace agents). Upgrade by re-pinning every agent
to a newer tag and re-running this repo's skill sync.

## Memory & Learning Loop

AEP already captures per-build lessons (`/aep-build` → `.dev-workflow/lessons.md`, archived by
`/aep-wrap` → `lessons-learned/`, recalled by `/aep-launch`). Two optional, self-describing skills
layer durable, searchable memory on top — engage them at these AEP seams:

- **`project-memory`** — recall at `/aep-dispatch` (query prior lessons before scoping a story),
  and at `/aep-wrap` persist the just-archived lesson into `project-memory/` for qmd-backed
  semantic recall.
- **`memory-forge`** — at `/aep-reflect` or before a PR, distill settled lessons (≥7 days, once ≥3
  have accrued) into reusable skills the next agent auto-loads.

## Project Conventions (authoritative)

The sections below describe **this repository's** design — its monorepo layout, technology stack,
and established conventions. They are authoritative: follow the existing structure and patterns,
place new code where the layout dictates, and match the stack already in use. Do not introduce
alternative frameworks, directory schemes, or tooling without explicit approval.

## Overview

Guidance for AI coding agents working in this repository.
