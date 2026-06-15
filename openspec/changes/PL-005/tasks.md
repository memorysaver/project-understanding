## 1. stylist module

- [x] 1.1 Create `packages/stylist` package (package.json, tsconfig, exports)
  following the monorepo's `@paperlens/*` package conventions, depending on
  `@paperlens/db` and `@paperlens/llm`.
- [x] 1.2 Implement `run({ db, complete }, { paperId })`: load the single active
  StylePrompt and the paper's latest Digest, call `complete({ stage: "style",
  messages })` with the prompt as the system message, and return the styled body.
- [x] 1.3 Advance the Paper to status `styled` on success; reject an empty styled
  body and leave the status unchanged.
- [x] 1.4 Inject `db` and `complete` so the stage runs offline (mockable llm).

## 2. Verification

- [x] 2.1 Integration test: a Digest fixture → non-empty styled body via a mocked
  llm and in-memory DB with the seeded default StylePrompt.
- [x] 2.2 Unit test: the system/style message equals the ACTIVE StylePrompt
  content (default), and equals the new content after an active-prompt flip.
- [x] 2.3 Unit test: the Paper advances to status `styled` on success.
- [x] 2.4 Contract test: `run` returns the styled-body output shape
  (`{ paperId, body, stylePromptId, digestId, model }`).
- [x] 2.5 Guardrail test: an empty styled body throws and leaves status unchanged.
