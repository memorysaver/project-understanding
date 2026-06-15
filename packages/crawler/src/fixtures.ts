// Deterministic arXiv API fixtures for tests — NO real network is used.
// ARXIV_ATOM_FIXTURE is a trimmed-but-faithful Atom feed as returned by
// export.arxiv.org/api/query?id_list=2401.00001, with the wrapped whitespace
// and the `&amp;` entity arXiv really emits, so the parser is exercised against
// realistic input. FIXTURE_ID is the id it describes.

export const FIXTURE_ID = "2401.00001";

export const ARXIV_ATOM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="html">ArXiv Query: search_query=&amp;id_list=2401.00001</title>
  <id>http://arxiv.org/api/abc123</id>
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <updated>2024-01-01T00:00:00Z</updated>
    <published>2024-01-01T00:00:00Z</published>
    <title>Attention &amp; Retrieval: A Study of
      Long-Context Reasoning</title>
    <summary>  We investigate how retrieval augmentation interacts with
      long-context attention in large language models. Our experiments show
      consistent gains on multi-hop reasoning benchmarks.
    </summary>
    <author>
      <name>Ada Lovelace</name>
    </author>
    <author>
      <name>Alan Turing</name>
    </author>
    <link href="http://arxiv.org/abs/2401.00001v1" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2401.00001v1" rel="related" type="application/pdf"/>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`;

/** An empty arXiv feed (no <entry>), as returned for an unknown id. */
export const ARXIV_EMPTY_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="html">ArXiv Query: search_query=&amp;id_list=0000.00000</title>
  <id>http://arxiv.org/api/empty</id>
</feed>`;
