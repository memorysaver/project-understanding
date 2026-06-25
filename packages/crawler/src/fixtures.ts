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

// --- Batch (list-endpoint) fixtures ----------------------------------------
// The list endpoint returns multiple <entry> elements (recent submissions), so
// each entry carries its own <id> the parser derives the arxiv_id from. These
// mirror the real list feed: a versioned <id>, wrapped whitespace, entities.

/** The three ids in ARXIV_BATCH_FIXTURE, in feed order. */
export const BATCH_IDS = ["2401.00010", "2401.00011", "2401.00012"] as const;

export const ARXIV_BATCH_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="html">ArXiv Query: search_query=cat:cs.CL</title>
  <id>http://arxiv.org/api/batch123</id>
  <entry>
    <id>http://arxiv.org/abs/2401.00010v1</id>
    <published>2024-01-10T00:00:00Z</published>
    <title>Sparse Mixtures for Efficient
      Long-Context Models</title>
    <summary>  We propose a sparse mixture-of-experts routing scheme that scales
      long-context inference with sublinear cost.
    </summary>
    <author><name>Grace Hopper</name></author>
    <author><name>Katherine Johnson</name></author>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.00011v2</id>
    <published>2024-01-11T00:00:00Z</published>
    <title>Retrieval &amp; Reasoning at Scale</title>
    <summary>  A study of how retrieval interacts with chain-of-thought reasoning
      across model sizes.
    </summary>
    <author><name>Barbara Liskov</name></author>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.00012v1</id>
    <published>2024-01-12T00:00:00Z</published>
    <title>Calibration of Instruction-Tuned Models</title>
    <summary>  We measure confidence calibration before and after instruction
      tuning on open benchmarks.
    </summary>
    <author><name>Radia Perlman</name></author>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`;

/**
 * A batch feed whose middle entry is malformed (no <summary>, no <author>) — the
 * parser must skip it and still return the two well-formed entries
 * (2401.00010 and 2401.00012).
 */
export const ARXIV_BATCH_MALFORMED_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="html">ArXiv Query: search_query=cat:cs.CL</title>
  <id>http://arxiv.org/api/batchbad</id>
  <entry>
    <id>http://arxiv.org/abs/2401.00010v1</id>
    <title>Sparse Mixtures for Efficient Long-Context Models</title>
    <summary>We propose a sparse mixture-of-experts routing scheme.</summary>
    <author><name>Grace Hopper</name></author>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.00099v1</id>
    <title>Malformed Entry With No Summary Or Authors</title>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.00012v1</id>
    <title>Calibration of Instruction-Tuned Models</title>
    <summary>We measure confidence calibration.</summary>
    <author><name>Radia Perlman</name></author>
  </entry>
</feed>`;

/**
 * A batch feed that OVERLAPS the single-id FIXTURE_ID (2401.00001) plus two new
 * ids — used to assert discover persists/returns only the not-yet-seen papers.
 */
export const ARXIV_BATCH_OVERLAP_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="html">ArXiv Query: search_query=cat:cs.CL</title>
  <id>http://arxiv.org/api/batchoverlap</id>
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <title>Attention &amp; Retrieval: A Study of
      Long-Context Reasoning</title>
    <summary>We investigate retrieval augmentation.</summary>
    <author><name>Ada Lovelace</name></author>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.00011v2</id>
    <title>Retrieval &amp; Reasoning at Scale</title>
    <summary>A study of retrieval and reasoning.</summary>
    <author><name>Barbara Liskov</name></author>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.00012v1</id>
    <title>Calibration of Instruction-Tuned Models</title>
    <summary>We measure confidence calibration.</summary>
    <author><name>Radia Perlman</name></author>
  </entry>
</feed>`;
