// @paperlens/stylist — the stylist pipeline stage for PaperLens.
// Rewrites a paper's Digest into a styled post body using the single active
// (default) StylePrompt as the voice, then advances the Paper to `styled`.
// See docs/technical-spec.md §2 (pipeline) and PL-001 (single-active prompt).
export { run } from "./run";
export type { StylistResult, StylistDeps, RunArgs } from "./run";
