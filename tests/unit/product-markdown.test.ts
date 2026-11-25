import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { renderProductMarkdown, safeUrl } from "@/components/store/pdp/markdown";

/** The admin editor preview and the storefront render descriptions with this one function. */
describe("renderProductMarkdown (storefront and admin preview)", () => {
  it("drops a javascript: link but keeps its text", () => {
    const html = renderProductMarkdown("[click me](javascript:alert(document.cookie))");
    expect(html).not.toMatch(/href/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain("click me");
  });

  it.each([
    "[x](JaVaScRiPt:alert(1))",
    "[x](  javascript:alert(1))",
    "[x](java\tscript:alert(1))",
    "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    "[x](vbscript:msgbox(1))",
    "[x](&#106;avascript:alert(1))",
    "[x](//evil.example/path)",
    "[x](/\\evil.example/path)",
    "<javascript:alert(1)>",
    "[x][ref]\n\n[ref]: javascript:alert(1)",
  ])("neutralises %j", (md) => {
    const html = renderProductMarkdown(md);
    expect(html).not.toMatch(/href=/i);
    expect(html).not.toMatch(/<a\b/i);
  });

  it("escapes raw HTML, so an <img onerror> never becomes an element", () => {
    const html = renderProductMarkdown('<img src=x onerror="alert(1)">\n\ntext <script>alert(2)</script> end');
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("turns an image with an unsafe source into plain alt text", () => {
    const html = renderProductMarkdown("![alt text](javascript:alert(1))");
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("alt text");
  });

  it("escapes quotes in the alt text and title of a legitimate image so attributes cannot be broken out of", () => {
    const html = renderProductMarkdown('![a" onerror="alert(1)](https://example.com/p.png "t\\" onload=\\"x")');
    // The quotes are entities, so the whole payload stays inside the alt / title values.
    expect(html).toContain('alt="a&quot; onerror=&quot;alert(1)"');
    expect(html).toContain('title="t&quot; onload=&quot;x"');
  });

  it("keeps safe links, with rel on external ones", () => {
    const html = renderProductMarkdown("[shop](https://example.com/a?b=1&c=2) [help](/help) [mail](mailto:a@b.co)");
    expect(html).toContain('href="https://example.com/a?b=1&amp;c=2"');
    expect(html).toContain('rel="nofollow noopener noreferrer"');
    expect(html).toContain('href="/help"');
    expect(html).toContain('href="mailto:a@b.co"');
  });
});

describe("safeUrl", () => {
  it("allows only http(s), mailto, tel, site paths and anchors", () => {
    expect(safeUrl("https://a.example/x")).toBe("https://a.example/x");
    expect(safeUrl("/shop")).toBe("/shop");
    expect(safeUrl("#top")).toBe("#top");
    expect(safeUrl("tel:+919876543210")).toBe("tel:+919876543210");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("//evil.example")).toBeNull();
    expect(safeUrl("/\\evil.example")).toBeNull();
    expect(safeUrl("")).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});

describe("the admin product preview", () => {
  const source = readFileSync("src/components/admin/products/MarkdownPreview.tsx", "utf8");

  it("renders through the sanitising storefront renderer, not a bare `marked`", () => {
    expect(source).toContain("renderProductMarkdown");
    expect(source).not.toMatch(/from\s+["']marked["']/);
  });

  it("the renderer it uses is free of server-only imports (it runs in the browser)", () => {
    const renderer = readFileSync("src/components/store/pdp/markdown.ts", "utf8");
    expect(renderer).not.toMatch(/server-only|next\/headers|@\/server\//);
  });
});
