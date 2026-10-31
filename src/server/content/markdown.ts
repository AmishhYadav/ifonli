import { Marked, type Tokens } from "marked";

import { escapeHtml, safeUrl } from "@/components/store/pdp/markdown";

import { MARK_END, MARK_KIND_END, MARK_START } from "./render-template";

/**
 * Policy / FAQ Markdown -> HTML for `dangerouslySetInnerHTML`. The source is owner-written (admin) plus
 * values from settings, so it is untrusted: raw HTML is escaped (never passed through), images become
 * their alt text, link URLs are limited to http(s), mailto, tel, `/path` and `#anchor`, and external links
 * open in a new tab with `rel="noopener noreferrer"`. Headings get stable ids for the table of contents.
 */

export interface Heading {
  id: string;
  text: string;
  depth: number;
}
export interface RenderedMarkdown {
  html: string;
  headings: Heading[];
}

/** Lowercase, hyphenated, ASCII-ish anchor id. */
export function slugifyHeading(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

/** Tag-free text of an HTML fragment (JSON-LD answers, meta descriptions). */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|li|h[1-6]|blockquote|tr)>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const MARKER = new RegExp(`${MARK_START}([a-z]+)${MARK_KIND_END}([\\s\\S]*?)${MARK_END}`, "g");
const MARKER_TITLE: Record<string, string> = {
  placeholder: "Placeholder value: set it in Admin > Settings before this page can be published",
  unresolved: "No value: this setting is missing, so this page cannot be published",
};

/** Turns the renderer's preview markers into visible <mark> elements (kind is whitelisted). */
function applyMarkers(html: string): string {
  return html.replace(MARKER, (_all, kind: string, inner: string) => {
    const known = kind === "placeholder" || kind === "unresolved" ? kind : "unresolved";
    return `<mark class="policy-marker" data-marker="${known}" title="${escapeHtml(MARKER_TITLE[known] ?? "")}">${inner}</mark>`;
  });
}

/** Stray sentinels (outside a complete marker) must never reach the page. */
const STRAY = /[-]/g;

export interface RenderMarkdownOptions {
  /** Drop the first `# H1` (the page already shows the policy title as its own heading). */
  dropTitle?: boolean;
}

export function renderMarkdown(markdown: string, options: RenderMarkdownOptions = {}): RenderedMarkdown {
  let titleDropped = !options.dropTitle;
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  const parser = new Marked({
    async: false,
    gfm: true,
    breaks: false,
    renderer: {
      html({ text }: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(text);
      },
      heading({ tokens, depth }: Tokens.Heading) {
        if (depth === 1 && !titleDropped) {
          titleDropped = true;
          return "";
        }
        const inner = this.parser.parseInline(tokens);
        const text = htmlToText(applyMarkers(inner).replace(/<[^>]*>/g, ""));
        const base = slugifyHeading(text);
        const count = used.get(base) ?? 0;
        used.set(base, count + 1);
        const id = count === 0 ? base : `${base}-${count + 1}`;
        if (depth === 2 || depth === 3) headings.push({ id, text, depth });
        return `<h${depth} id="${escapeHtml(id)}">${inner}</h${depth}>\n`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens);
        const url = safeUrl(href);
        if (!url) return text;
        const external = /^https?:\/\//i.test(url);
        const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : "";
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(url)}"${titleAttr}${attrs}>${text}</a>`;
      },
      image({ text }: Tokens.Image) {
        return escapeHtml(text);
      },
    },
  });
  const html = applyMarkers(parser.parse(markdown) as string).replace(STRAY, "");
  return { html, headings };
}
