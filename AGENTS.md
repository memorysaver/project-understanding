# AGENTS.md

Guidance for AI coding agents working in this repository.

## AEP Workflow

This project uses the Agentic Engineering Patterns (AEP) skills — a spec-driven, multi-agent
feature lifecycle in `.claude/skills/` and/or `.agents/skills/`, pinned via `skills-lock.json`.
The skills are self-describing; start with `aep-onboard`. Upgrade by re-running
`npx skills add memorysaver/agentic-engineering-patterns@<newtag>` once per agent.
