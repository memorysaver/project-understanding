# PaperLens

*Read the latest research like it's your favorite blog.*

## About

PaperLens is an AI-driven personal blog that continuously digests academic papers and republishes them as short, readable posts written in a voice you control. It is built for people who want to stay current with research but don't have time to read every paper end-to-end — PaperLens turns the firehose of academic publishing into a curated, opinionated feed.

## Why PaperLens

- Papers are dense, jargon-heavy, and time-consuming to read.
- Aggregators surface volume, not understanding.
- Existing summarizers feel generic — readers want a consistent *voice*, not a wall of bullet points.

PaperLens sits between the paper and the reader, doing the reading and the rewriting so the feed feels like something a single, thoughtful editor produces.

## Key features

- **Continuous ingestion** — agents poll paper sources on a schedule and pick up new work as it's published.
- **AI-rewritten posts** — each paper becomes a blog-style article in the voice you've defined.
- **Blog-like reading experience** — a clean, personal feed of articles, not a database UI.
- **Source-extensible** — starts with arxiv; new sources plug in behind the same pipeline.
- **Curation console** — a private backend where you write and iterate on the style prompt that defines PaperLens's voice.

## How it works

A new paper appears on a source. An agent picks it up, extracts what's interesting, rewrites it in your voice, and publishes it to the feed. The voice is controlled by a single prompt that you own and can edit at any time from the curation console.

```
arxiv (and future sources)
        │
        ▼
   [ Crawler ]  ──►  [ Digestor ]  ──►  [ Stylist ]  ──►  [ Publisher ]
                                              ▲
                                              │
                                    [ Curation Console ]
                                    (style & prompt control)
```

## The agent pipeline

Each stage has a single, well-defined job. Stages communicate through structured intermediates, so any one stage can be swapped without disturbing the others.

- **Crawler** — discovers new papers from configured sources and deduplicates by paper ID or DOI. Knows nothing about content or style.
- **Digestor** — reads the paper and extracts a structured digest of its contributions, methods, and results. This is the "what the paper says" layer, still unstyled.
- **Stylist** — rewrites the digest into a blog post using the active style prompt from the Curation Console. This is where the personality of PaperLens lives.
- **Publisher** — renders the styled post into the blog feed with a title, tags, and a citation back to the original paper.
- **Scheduler** — orchestrates the whole pipeline on a recurring cadence and handles retries when a stage fails.

## The reading experience

The reader-facing side of PaperLens looks and feels like a personal blog, not a research dashboard:

- A chronological feed of posts.
- Individual article pages with clean typography.
- A link from every post back to the source paper for anyone who wants to go deeper.

There is no search bar, no filter panel, no tag cloud at launch. The goal is for a reader to land on the feed and just *read*.

## The curation console

The curation console is the private backend where you shape PaperLens's voice. It is small on purpose — its job is to make the one thing that matters easy:

- Edit the **active style prompt** the Stylist uses.
- Preview how a sample paper would be rewritten with the current prompt before publishing.
- Maintain a small library of style presets to switch between.

This is the lever that makes PaperLens feel like *yours* and not a generic summarizer.

## Sources

- **Phase 1 (MVP):** arxiv.
- **Later:** additional venues such as OpenReview, ACL Anthology, and bioRxiv. New sources are added behind the same Crawler interface so the rest of the pipeline doesn't change.

## Roadmap

- **Phase 1 — arxiv MVP.** End-to-end pipeline against arxiv, basic blog frontend, and a Curation Console with a single active style prompt.
- **Phase 2 — More sources.** Pluggable crawlers for additional venues; per-source tagging in the feed.
- **Phase 3 — Personalization.** Multi-prompt style library, topic-specific voices, and reader-side preferences such as following topics or authors and saving articles.

## Status

Early — defining product scope. This README is the source of truth for now.
