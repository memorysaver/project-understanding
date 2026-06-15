// Build a Post citation from the source Paper's metadata.
//
// At Layer 0 the citation is a single human-readable line assembled from the
// Paper the post is derived from — authors, title, arXiv id, and the source
// link — so a reader can attribute and find the original work.

export type CitationSource = {
  arxivId: string;
  title: string;
  authors: string[];
  sourceUrl: string;
};

/**
 * Assemble a citation line from Paper metadata, e.g.
 * `Ada Lovelace, Alan Turing. "On Computable Numbers." arXiv:2401.00001. https://arxiv.org/abs/2401.00001`
 */
export function buildCitation(paper: CitationSource): string {
  const authors = paper.authors.length > 0 ? paper.authors.join(", ") : "Unknown author";
  return `${authors}. "${paper.title}." arXiv:${paper.arxivId}. ${paper.sourceUrl}`;
}
