import { createFileRoute, Link } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/")({
  component: FeedComponent,
});

// PL-009 — chronological reader feed. Renders published posts newest-first via
// the public api.listPosts; each item links to its article page. No search or
// filter UI (Layer 0).
function FeedComponent() {
  const feed = useQuery(orpc.listPosts.queryOptions({ input: {} }));

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 font-bold text-2xl">Latest</h1>

      {feed.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : feed.data && feed.data.items.length > 0 ? (
        <ul className="grid gap-4">
          {feed.data.items.map((post) => (
            <li key={post.id} className="rounded-lg border p-4">
              <Link
                to="/posts/$id"
                params={{ id: post.id }}
                className="font-medium text-lg hover:underline"
              >
                {post.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No posts published yet.</p>
      )}
    </div>
  );
}
