// Sanitize an LLM-produced body before it is stored as a renderable Post body.
//
// The stylist emits prose that may contain light HTML (paragraphs, emphasis,
// links). It is untrusted text from a model, so before persisting it as the
// renderable `body` we remove anything that could execute or exfiltrate when
// the post is rendered: <script>/<style> (and similar) elements and their
// contents, all event-handler attributes (`on*`), and `javascript:` URLs.
// Tags outside a small safe allowlist are dropped while their text content is
// kept. This is a storage-time defense; the renderer should still treat the
// body appropriately.

// Block-level elements whose entire content is unsafe and is discarded wholesale.
const DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "noscript"];

// Tags whose markup we keep (the element is preserved). Anything else has its
// tags stripped but its inner text retained.
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

/**
 * Strip unsafe markup from an LLM-produced body and return a renderable body.
 *
 * - Removes `<script>`, `<style>`, `<iframe>`, and similar elements together
 *   with their contents.
 * - Drops every `on*` event-handler attribute.
 * - Neutralizes `javascript:` (and other script-bearing) URLs in `href`/`src`.
 * - Keeps a small allowlist of formatting tags; removes the tags of anything
 *   else while preserving the inner text.
 */
export function sanitizeBody(input: string): string {
  let html = input;

  // 1. Remove dangerous elements together with everything inside them.
  for (const tag of DROP_WITH_CONTENT) {
    const withContent = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    html = html.replace(withContent, "");
    // Drop any stray/unclosed opening or closing tag too.
    html = html.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");
  }

  // 2. Process the remaining tags: drop disallowed ones, scrub allowed ones.
  html = html.replace(
    /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,
    (_match, slash, rawName, attrs) => {
      const name = String(rawName).toLowerCase();
      if (!ALLOWED_TAGS.has(name)) {
        // Disallowed tag: remove the markup, keep surrounding text.
        return "";
      }
      if (slash === "/") {
        return `</${name}>`;
      }
      return `<${name}${scrubAttributes(String(attrs))}>`;
    },
  );

  return html;
}

// Remove event-handler attributes and neutralize script-bearing URLs, keeping
// only benign attributes on allowed tags.
function scrubAttributes(attrs: string): string {
  let out = "";
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(attrs)) !== null) {
    const rawAttr = m[1] ?? "";
    const name = rawAttr.toLowerCase();
    const value = m[3] ?? m[4] ?? m[5] ?? "";

    // Drop all event handlers (onclick, onerror, ...).
    if (name.startsWith("on")) continue;

    // Neutralize script-bearing URLs in href/src.
    if ((name === "href" || name === "src") && isUnsafeUrl(value)) continue;

    out += ` ${name}="${value.replace(/"/g, "&quot;")}"`;
  }
  return out;
}

function isUnsafeUrl(value: string): boolean {
  // Strip whitespace/control chars used to obfuscate the scheme, then test.
  // oxlint-disable-next-line no-control-regex
  const normalized = value.replace(/[\s\u0000-\u001f]+/g, "").toLowerCase();
  return (
    normalized.startsWith("javascript:") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("vbscript:")
  );
}
