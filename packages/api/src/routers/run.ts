import { enqueueDiscovery, type PipelineDeps } from "@paperlens/orchestrator";
import { protectedProcedure } from "../index";

// Console (auth-gated) manual ingest (PL-020). The owner triggers a discovery
// run on demand. Composes on protectedProcedure (PL-014): an unauthenticated
// call is rejected with 401 before the handler runs, so no Run row is created
// and no message is enqueued.
//
// This is a thin wrapper — the Run-row insert and the single `discover` enqueue
// both live in the orchestrator's enqueueDiscovery (PL-018, single source of
// truth). triggerRun adds only the auth gate and the fixed "manual" trigger,
// then returns the orchestrator's { runId }. No input.
//
// context.db (the api's `Db`) and the orchestrator's `CrawlerDb` are
// structurally identical Drizzle SQLite handles but nominally distinct, so the
// db is cast to the deps' db type at the call boundary (as the orchestrator's
// own offline drivers do). The injected context.queue is already typed as the
// orchestrator's QueueProducer; in production it is absent so enqueueDiscovery
// lazily binds the real PIPELINE_QUEUE.
export const triggerRun = protectedProcedure.handler(async ({ context }) => {
  return enqueueDiscovery("manual", {
    db: context.db as PipelineDeps["db"],
    queue: context.queue,
  });
});
