import { ORPCError } from "@orpc/client";
import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/posts/$id")({
  component: ArticleComponent,
});

// PL-010 — reader article page. Renders a published post's title, body, and a
// link back to the source paper via the public api.getPost. Unknown or
// unpublished ids come back as NOT_FOUND and render a not-found state.
function ArticleComponent() {
  const { id } = Route.useParams();
  const article = useQuery(orpc.getPost.queryOptions({ input: { id } }));

  if (article.isLoading) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    );
  }

  if (article.isError || !article.data) {
    const notFound =
      article.error instanceof ORPCError && article.error.code === "NOT_FOUND";
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-2 font-bold text-2xl">
          {notFound ? "Post not found" : "Something went wrong"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {notFound
            ? "This article doesn't exist or isn't published."
            : "Couldn't load this article. Please try again."}
        </p>
      </div>
    );
  }

  const post = article.data;
  // The post body was sanitized at publish time (PL-006) to a safe HTML
  // allowlist, so it is rendered as markup here.
  // The source paper is the arXiv entry identified by paperId.
  const sourceUrl = `https://arxiv.org/abs/${post.paperId}`;

  return (
    <article className="container mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 font-bold text-3xl">{post.title}</h1>

      <div
        className="prose dark:prose-invert max-w-none"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: body is sanitized at publish time (PL-006)
        dangerouslySetInnerHTML={{ __html: post.body }}
      />

      <footer className="mt-8 border-t pt-4 text-muted-foreground text-sm">
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="underline hover:no-underline"
        >
          View source paper
        </a>
        <p className="mt-2">{post.citation}</p>
      </footer>
    </article>
  );
}
