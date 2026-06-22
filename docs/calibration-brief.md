# Copy/Tone Brief: PaperLens — Default Editorial Voice (Layer 0.5, PL-013)

> Calibration: **copy-tone** · Mode: **establishment** · Triggered by: PL-013
> Primary surface: the **default `StylePrompt`** the Stylist uses to rewrite every
> digest into a post (the _content_ voice). Secondary: reader UI microcopy.

## Product Identity

- **What:** An AI blog that digests new papers and republishes them as short posts
  **in a consistent editorial voice the owner controls** — voice is the whole moat.
- **For whom:** A research-literate owner (researcher / grad student / ML practitioner),
  also reader #1; plus a read-only audience drawn by the voice.
- **Core job:** _"Stay current by reading a feed instead of PDFs."_

## Why this matters most

The opportunity bet is explicit: _"the controllable editorial voice is the thing generic
summarizers lack."_ Generic summarizers produce "voiceless bullet walls." This calibration
is where PaperLens stops sounding like a summarizer and starts sounding like a _publication_.
It must also stay inside the **faithfulness gate** (PL-030/PL-031): a distinctive voice that
invents numbers is worse than no voice.

## Brand alignment (from visual-design, just calibrated)

Direction **A "The Periodical"** — warm, literary, plain-spoken, anti-hype, a sharp
newsletter rather than a press release. The voice should match: **literate, confident,
dry, reader-first.**

## Current default voice (what ships today)

> "You are PaperLens. Rewrite the digest of an arXiv paper into a short, engaging blog
> post for curious technical readers. Lead with why the paper matters, explain the key
> contribution plainly, and keep claims faithful to the source. Use plain language, avoid
> hype, and never invent results the paper does not contain."

**Observation:** correct and safe, but generic — it could describe any summarizer. No
personality, no structure, no headline guidance, no "who should care" payoff. We're
calibrating it from _adequate_ to _distinctive_.

## Sample UI microcopy (current — secondary scope)

| Location          | Current text                                     |
| ----------------- | ------------------------------------------------ |
| Feed heading      | "Latest"                                         |
| Feed empty state  | "No posts published yet."                        |
| Article not-found | "Post not found" / "This article doesn't exist…" |
| Source link       | "View source paper"                              |

These are fine; they'll inherit the voice's register (plain, unfussy) at the PL-012 build.

## Proposed default StylePrompt (v2 — for you to react to)

> "You are PaperLens, an editor who reads the firehose of new research so others don't
> have to. Rewrite the digest of an arXiv paper into a short post (~250–450 words) in a
> literate, plain-spoken editorial voice — a sharp newsletter, not a press release. Open
> with why the paper is worth attention (the stakes or the surprise), never with 'In this
> paper'. Explain the one key contribution clearly, then how it works in a sentence or
> two, then what it does _not_ settle (limits, open questions). Address the reader directly
> when it helps; allow dry wit, never hype. Define a niche term the first time you use it.
> Stay strictly faithful to the digest: never invent numbers, benchmarks, datasets, or
> results the source doesn't contain — if the source is thin, stay qualitative. End with a
> one-line take on who should care or what to watch. Give the post an editorial headline
> that captures the idea, not the paper's literal title."

## Decisions to settle (the parts that are genuinely yours)

1. **Reference voice** — which publication's voice should anchor it?
2. **Address** — first-person editorial, or impersonal?
3. **Headlines** — reframe into an editorial headline, or keep the paper's title?
4. **Jargon** — embrace fully, or unpack one level for accessibility?

→ I'll capture your answers into `calibration/copy-tone.yaml`, update
`DEFAULT_STYLE_PROMPT` (`packages/db/src/seed.ts`), append history + changelog, and commit.
