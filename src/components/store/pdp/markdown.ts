import { Marked, type Tokens } from "marked";

/**
 * Product description Markdown -> HTML for `dangerouslySetInnerHTML`. The text is written in the admin, so it
 * is treated as untrusted: raw HTML is escaped (never passed through), link and image URLs are limited to
 * http(s), mailto, tel and site-relative paths, and external links get `rel="nofollow noopener noreferrer"`.
 */

const escapeMap: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => escapeMap[c] ?? c);
}

const SAFE_URL = /^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;

/** Returns the URL when it is safe to put in an `href` / `src`, else null. */
export function safeUrl(href: string | null | undefined): string | null {
  const url = (href ?? "").trim();
  // Control characters and whitespace inside a scheme are a classic bypass ("java\tscript:").
  if (/[\u0000-\u001f\u007f\s]/.test(url)) return null;
  return SAFE_URL.test(url) ? url : null;
}

const parser = new Marked({
  async: false,
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens);
      const url = safeUrl(href);
      if (!url) return text;
      const external = /^https?:\/\//i.test(url);
      const rel = external ? ' rel="nofollow noopener noreferrer" target="_blank"' : "";
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(url)}"${titleAttr}${rel}>${text}</a>`;
    },
    image({ href, title, text }: Tokens.Image) {
      const url = safeUrl(href);
      if (!url) return escapeHtml(text);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${titleAttr} loading="lazy">`;
    },
  },
});

export function renderProductMarkdown(markdown: string): string {
  return parser.parse(markdown) as string;
}

/** Plain text of a Markdown description (meta description, JSON-LD), trimmed to `max` characters. */
export function markdownToPlainText(markdown: string | null | undefined, max = 300): string {
  if (!markdown) return "";
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/[`*_~>#]+/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
