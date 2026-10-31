import { describe, expect, it } from "vitest";

import { parseFrontMatter } from "@/server/content/front-matter";
import { htmlToText, renderMarkdown, slugifyHeading } from "@/server/content/markdown";
import { prepareContent } from "@/server/content/publish";
import { MARK_END, MARK_KIND_END, MARK_START } from "@/server/content/render-template";

describe("renderMarkdown sanitisation", () => {
  it("escapes raw HTML: script, iframe and event handlers never become elements", () => {
    const { html } = renderMarkdown(
      [
        "<script>alert(1)</script>",
        "",
        '<iframe src="https://evil.example"></iframe>',
        "",
        '<img src=x onerror="alert(1)">',
        "",
        'text <b onclick="x()">bold</b>',
      ].join("\n"),
    );
    expect(html).not.toMatch(/<script|<iframe|<img|<b /i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;iframe");
  });

  it("drops javascript: and data: link targets but keeps the text", () => {
    const { html } = renderMarkdown("[x](javascript:alert(1)) [y](data:text/html;base64,AAA) [z](java\tscript:1)");
    expect(html).not.toContain("href");
    expect(html).toContain("x");
  });

  it("turns images into their alt text", () => {
    const { html } = renderMarkdown("![alt text](https://example.com/a.png)");
    expect(html).not.toContain("<img");
    expect(html).toContain("alt text");
  });

  it("opens external links safely and keeps internal links plain", () => {
    const { html } = renderMarkdown("[out](https://example.com) [in](/help) [mail](mailto:a@b.co)");
    expect(html).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('<a href="/help">in</a>');
    expect(html).toContain('href="mailto:a@b.co"');
  });

  it("gives headings stable, unique ids and lists h2/h3 for the contents", () => {
    const r = renderMarkdown("# T\n\n## Where we deliver\n\n### Detail\n\n## Where we deliver\n\n## R&D");
    expect(r.headings).toEqual([
      { id: "where-we-deliver", text: "Where we deliver", depth: 2 },
      { id: "detail", text: "Detail", depth: 3 },
      { id: "where-we-deliver-2", text: "Where we deliver", depth: 2 },
      { id: "r-and-d", text: "R&D", depth: 2 },
    ]);
    expect(r.html).toContain('<h2 id="where-we-deliver">');
  });

  it("can drop the leading H1", () => {
    const r = renderMarkdown("# Title\n\nBody", { dropTitle: true });
    expect(r.html).not.toContain("<h1");
    expect(renderMarkdown("# Title").html).toContain("<h1");
  });

  it("converts preview markers into <mark> elements and removes stray sentinels", () => {
    const { html } = renderMarkdown(
      `a ${MARK_START}placeholder${MARK_KIND_END}0${MARK_END} b ${MARK_START}evil" onx=${MARK_KIND_END}x${MARK_END} ${MARK_END}`,
    );
    expect(html).toContain('<mark class="policy-marker" data-marker="placeholder"');
    expect(html.match(/<mark/g)).toHaveLength(1);
    expect(html).not.toContain('" onx=');
    expect(html).not.toMatch(/[-]/);
  });

  it("slugifies and converts HTML to text", () => {
    expect(slugifyHeading("  Café — Returns & Refunds! ")).toBe("cafe-returns-and-refunds");
    expect(slugifyHeading("!!!")).toBe("section");
    expect(htmlToText("<p>A &amp; B</p><ul><li>one</li><li>two</li></ul>")).toBe("A & B one two");
  });
});

describe("prepareContent (publishing rule)", () => {
  const ctx = { x: { value: "PLACEHOLDER — x", blocking: false }, y: { value: "ok", blocking: false } };
  const base = { ctx, bodyMd: "# T\n\nHello {{settings.y}}" };

  it("production withholds unpublished content", () => {
    const r = prepareContent({ ...base, published: false, review: false });
    expect(r).toMatchObject({ html: "", withheld: "unpublished", draft: true });
  });

  it("production withholds published content with placeholder or unresolved tokens", () => {
    const placeholder = prepareContent({ ...base, bodyMd: "{{settings.x}}", published: true, review: false });
    expect(placeholder).toMatchObject({ html: "", withheld: "unresolved" });
    const missing = prepareContent({ ...base, bodyMd: "{{settings.zzz}}", published: true, review: false });
    expect(missing.withheld).toBe("unresolved");
  });

  it("production shows published, fully resolved content", () => {
    const r = prepareContent({ ...base, published: true, review: false, dropTitle: true });
    expect(r.withheld).toBeNull();
    expect(r.draft).toBe(false);
    expect(r.html).toContain("Hello ok");
  });

  it("review mode shows drafts with markers", () => {
    const r = prepareContent({ ...base, bodyMd: "{{settings.x}}", published: false, review: true });
    expect(r.withheld).toBeNull();
    expect(r.draft).toBe(true);
    expect(r.html).toContain("policy-marker");
    expect(r.problems).toHaveLength(1);
  });
});

describe("parseFrontMatter", () => {
  it("reads quoted, bare, null and integer values and returns the body", () => {
    const { data, body } = parseFrontMatter(
      '---\ntitle: "Shipping Policy"\nslug: shipping\nversion: 0.1-draft\nstatus: "DRAFT — x: y"\nlastReviewed: null\nn: 3\n---\n\n# Hi\n',
    );
    expect(data).toEqual({
      title: "Shipping Policy",
      slug: "shipping",
      version: "0.1-draft",
      status: "DRAFT — x: y",
      lastReviewed: null,
      n: 3,
    });
    expect(body).toBe("# Hi\n");
  });

  it("rejects a document without front matter", () => {
    expect(() => parseFrontMatter("# nope")).toThrow(/front matter/);
  });
});
