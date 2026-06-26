import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/console/")({
  component: ConsoleIndexComponent,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

// PL-020 — console "Run now" trigger (auth-gated). The owner ingests on demand:
// the button calls api.triggerRun (auth-gated; reuses the credentialed orpc
// client) which enqueues a discovery run and returns its runId. Minimal wiring —
// no run-status/history view (that is a later console view). The reader side has
// no such control, and an unauthenticated call is rejected (the route redirects
// to /login; the procedure fails closed with 401).
function ConsoleIndexComponent() {
  const trigger = useMutation(orpc.triggerRun.mutationOptions());

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 font-bold text-2xl">Run now</h1>

      <button
        type="button"
        disabled={trigger.isPending}
        onClick={() => trigger.mutate({})}
        className="rounded border px-4 py-2 text-sm hover:bg-muted"
      >
        {trigger.isPending ? "Starting…" : "Run now"}
      </button>

      {trigger.data ? (
        <p className="mt-4 text-muted-foreground text-sm">
          Run started: <code className="font-mono">{trigger.data.runId}</code>
        </p>
      ) : null}
    </div>
  );
}
