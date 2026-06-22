# Design Brief: PaperLens — Reader Visual Design (Layer 0.5)

> Calibration: **visual-design** · Mode: **establishment** · Triggered by: PL-012
> Scope: the **reader-facing** surface only (feed + article). The Curation Console
> (owner-only, Layer 1) is *not* in this brief.

## Product Identity

- **What:** An AI blog that continuously digests new papers and republishes them as
  short posts **in a consistent editorial voice the owner controls** — the firehose
  turned into a curated, well-written feed you'd actually enjoy reading.
- **For whom:** A research-literate owner (researcher / grad student / ML practitioner)
  who is also reader number one; plus a secondary read-only audience drawn by the voice.
- **Core job:** *"When a wave of new papers lands, I want to stay current by reading a
  feed instead of PDFs."*
- **Why now:** Long-context LLMs make a faithful, voice-consistent digest cheap to run
  on a schedule. The differentiator is **editorial voice and reading quality**, not
  aggregation volume.

**Design north star:** This is a *publication*, not a dashboard. The competition
(arXiv-sanity, Papers with Code, Scholar Inbox) surfaces **volume**; PaperLens sells
**understanding and voice**. The visual design must read as a crafted periodical — calm,
typographic, readability-first — and must *not* look like another busy aggregator or a
generic shadcn admin panel. Reading comfort is the whole product.

## Pages to Design

Only two reader pages exist at Layer 0, and both are in scope for this calibration.

### 1. Feed (`/`)

- **Purpose:** Reverse-chronological list of published posts — the "front page" (PL-009).
- **Content blocks (today):** page heading ("Latest"), a list of post **titles** linking
  to their articles. That's it.
- **Design opportunity:** decide what a feed *item* should carry beyond the title —
  e.g. a one-line digest/dek, publish date, source venue (arXiv), estimated read time.
  These are design decisions; the data (title, body, citation, paperId, publishedAt)
  already exists. The MVP boundary forbids search/filter/tag UI here — keep it a clean
  reading index, not a control surface.
- **Key interaction:** scan → click a title → read the article.

### 2. Article (`/posts/$id`)

- **Purpose:** The post itself — title, body, and a citation/link back to the source
  paper (PL-010).
- **Content blocks (today):** `h1` title; sanitized HTML body rendered via Tailwind
  `prose`; a footer with a "View source paper" arXiv link + citation string.
- **Design opportunity:** this is where reading quality is won or lost — measure (line
  length), type scale, heading rhythm, link styling, blockquote/code treatment, and how
  the source citation is presented (footer vs. header byline). Also: the not-found and
  loading states.
- **Key interaction:** read top-to-bottom → optionally click through to the paper.

## Design Directions

Three directions spanning a spectrum from **most approachable/literary** to **most
technical**. Pick one (or splice), then design both pages in it.

### Direction A: "The Periodical" — *most approachable / literary*

A warm, editorial magazine feel. Serif display headlines, generous whitespace, a narrow
single-column measure (~65–70ch), subtle paper-toned background rather than pure white.
Feels hand-curated and authored — leans hard into "voice."
- **Reference products:** Stratechery, Every.to, Matt Levine's *Money Stuff*, The Browser.
- **Strengths:** maximally differentiated from aggregators; signals editorial care and a
  human voice — exactly PaperLens's bet. Best-in-class long-form reading comfort.
- **Risks:** can read as "soft"/non-technical to an ML audience; serif + warm tones may
  feel off for dense equations or code-heavy digests.

### Direction B: "Reading Room" — *balanced (recommended starting point)*

A modern, minimal blog. Clean sans (or sans headings + serif body), restrained neutral
palette with **one** quiet accent, comfortable measure, light-first with a real dark mode.
Quietly premium, gets out of the way.
- **Reference products:** Linear blog, Vercel blog, Ghost's default (Casper), Bear Blog.
- **Strengths:** broad appeal; modern without being trendy; easiest to evolve into the
  Console later for visual consistency; smallest leap from the current shadcn baseline.
- **Risks:** if under-designed it collapses back into "generic default" — the accent,
  type scale, and feed-item treatment must do real work to avoid that.

### Direction C: "Lab Notes" — *most technical*

A dense, technical, arXiv-adjacent look. Dark-default, monospace accents (metadata, venue,
dates, inline code), tighter rhythm, structured/grid-ish feed. Feels like a research tool.
- **Reference products:** Distill.pub, arXiv-sanity, Obsidian Publish, refined Hacker News.
- **Strengths:** instant credibility with the ML/researcher persona; native home for math,
  code, and citations.
- **Risks:** pulls *toward* the aggregator/tool aesthetic the product is trying to escape;
  monospace + density can fight long-form reading comfort and the "voice" story.

> **Decision the directions force:** is PaperLens primarily a *publication you read for
> pleasure* (A), or a *research tool with good typography* (C)? B sits deliberately in the
> middle. Your pick here is really a positioning call, not just a palette.

## Technical Constraints

- **Stack:** React 19 + Vite + TanStack Router; **Tailwind v4** + **shadcn/ui**; shared
  component lib at `packages/ui`. Article body already renders through the Tailwind
  **`prose`** (typography) plugin — your type decisions should target `prose` overrides.
- **Current theme** (`packages/ui/src/styles/globals.css`): the **stock shadcn neutral
  default** — a fully **achromatic oklch palette (chroma = 0, pure grayscale)**, no accent
  hue, `--font-sans: "Inter Variable"`, `--radius: 0.625rem`, light + dark both defined.
  This is the generic baseline we are calibrating *away* from; treat nothing here as sacred
  except the token *structure* (which `globals.css` must keep so components keep working).
- **Available components** (`packages/ui/src/components/`): `button`, `card`, `input`,
  `label`, `checkbox`, `dropdown-menu`, `skeleton`, `sonner`. Header today is a minimal
  top nav (`Home` / `Dashboard` + mode toggle + user menu) with an `<hr>` — top-nav, not
  sidebar. Reader pages currently use `container mx-auto max-w-3xl`.
- **Requirements:** Responsive (mobile → desktop) **and** a real light + dark mode (the
  mode toggle already ships). Pick which mode is the *default* as part of the direction.

## Deliverable

Explore the directions and produce designs for **both pages** (Feed + Article), in both
light and dark. The goal is to lock:

1. **Color palette** — light + dark, expressed (or convertible to) **oklch** so it drops
   into `globals.css`. Decide the one accent hue, if any.
2. **Typography** — heading + body font families (incl. any serif/mono), the type scale,
   and the reading **measure** for the article. This is the highest-leverage decision.
3. **Component styling** — feed-item card, links, buttons, the article `prose` treatment,
   citation/source footer, loading (skeleton) + empty + not-found states.
4. **Layout** — max content width, nav style (keep top-nav unless you have a reason),
   spacing rhythm, default mode.
5. **Brand feel** — the 2–3 visual signals that say "this is PaperLens" at a glance.

---

## Next steps (you do these)

1. **Pick a direction** (A / B / C, or a splice) — this is the positioning call above.
2. **Explore variations** in a vibe-design tool — see
   `.claude/skills/aep-calibrate/references/vibe-design-tools.md` (Google Stitch,
   Pencil.dev, or just hand-tuned screenshots). Design the Feed and the Article.
3. **Save references** (screenshots / exports) to `docs/design-references/` —
   e.g. `feed-light.png`, `feed-dark.png`, `article-light.png`, `article-dark.png`.
4. **Come back and run** `/aep-calibrate capture` — I'll walk you through capturing the
   palette (→ `calibration/visual-design.yaml` **and** `globals.css`), typography, layout,
   component notes, and brand signals, then commit.

> Heavy calibration pauses here by design — the exploration is yours to drive. When you've
> got designs you like (even rough), come back with `/aep-calibrate capture`.
