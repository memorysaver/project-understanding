import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/console/posts")({
  component: ConsolePostsComponent,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

// PL-021 — console post controls (auth-gated). The owner unpublishes a
// published post or republishes one by id via api.setPostStatus (auth-gated;
// reuses the same credentialed orpc client). Minimal wiring: the feed listing
// reuses the public listPosts (published only); republish-by-id covers the
// posts the feed no longer shows once unpublished.
function ConsolePostsComponent() {
  const queryClient = useQueryClient();
  const feed = useQuery(orpc.listPosts.queryOptions({ input: {} }));
  const [republishId, setRepublishId] = useState("");

  const setStatus = useMutation(
    orpc.setPostStatus.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.listPosts.key() }),
    }),
  );

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 font-bold text-2xl">Manage posts</h1>

      {feed.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : feed.data && feed.data.items.length > 0 ? (
        <ul className="grid gap-3">
          {feed.data.items.map((post) => (
            <li key={post.id} className="flex items-center justify-between rounded-lg border p-4">
              <span className="font-medium">{post.title}</span>
              <button
                type="button"
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ id: post.id, status: "unpublished" })}
                className="rounded border px-3 py-1 text-sm hover:bg-muted"
              >
                Unpublish
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No published posts.</p>
      )}

      <form
        className="mt-8 flex items-center gap-2 border-t pt-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!republishId.trim()) return;
          setStatus.mutate(
            { id: republishId.trim(), status: "published" },
            { onSuccess: () => setRepublishId("") },
          );
        }}
      >
        <input
          value={republishId}
          onChange={(e) => setRepublishId(e.target.value)}
          placeholder="Post id to republish"
          className="flex-1 rounded border px-3 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={setStatus.isPending}
          className="rounded border px-3 py-1 text-sm hover:bg-muted"
        >
          Republish
        </button>
      </form>
    </div>
  );
}
