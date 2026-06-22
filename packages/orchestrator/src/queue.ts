// @paperlens/orchestrator — the pipeline queue message contract (PL-018, ADR-001).
//
// The pipeline runs over a single Cloudflare Queue carrying one message per
// (paper, stage). The consumer (in `apps/server`) routes purely on `type`; all
// pipeline logic lives in the orchestrator's stage handlers. This module defines
// the message shape that is the contract between the producer (orchestrator) and
// the consumer (server) — validated by the contract test (PL-018 task 6.4).

/** The pipeline stages, in order. Discovery is the only fan-out point. */
export const PIPELINE_MESSAGE_TYPES = ["discover", "digest", "style", "publish"] as const;
export type PipelineMessageType = (typeof PIPELINE_MESSAGE_TYPES)[number];

/**
 * A pipeline queue message: `{ type, arxiv_id?, runId }`.
 *
 * - `discover` carries no `arxiv_id` (it fans out, enqueuing one `digest` per
 *   new paper).
 * - `digest` / `style` / `publish` each carry the target paper's `arxiv_id`.
 * - `runId` is the discovery `Run`'s id, threaded through every message so a
 *   run's stats can be aggregated.
 */
export type PipelineMessage =
  | { type: "discover"; runId: string; arxiv_id?: undefined }
  | { type: "digest" | "style" | "publish"; arxiv_id: string; runId: string };

/**
 * The producer side of the pipeline queue, as the handlers depend on it. The
 * Cloudflare `Queue` binding satisfies this (`send(body)`); tests inject a fake
 * that records the messages instead of delivering them.
 */
export interface QueueProducer {
  send(message: PipelineMessage): Promise<void>;
}

/** Narrow an arbitrary decoded message to a valid `PipelineMessage`, else null. */
export function parsePipelineMessage(value: unknown): PipelineMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const msg = value as Record<string, unknown>;
  if (typeof msg.runId !== "string") return null;
  if (msg.type === "discover") {
    return { type: "discover", runId: msg.runId };
  }
  if (msg.type === "digest" || msg.type === "style" || msg.type === "publish") {
    if (typeof msg.arxiv_id !== "string") return null;
    return { type: msg.type, arxiv_id: msg.arxiv_id, runId: msg.runId };
  }
  return null;
}
