import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { VIBES } from "@/features/vibe/config";

const css = readFileSync(path.resolve(process.cwd(), "src/styles/nav-pills.css"), "utf8");

describe("nav pill states (styles/nav-pills.css)", () => {
  it("lights the pill of every vibe from html[data-vibe], with no React state", () => {
    for (const v of VIBES) {
      expect(css).toContain(`:root[data-vibe="${v}"] .nav-pill[data-nav-vibe="${v}"] .nav-pill-face`);
    }
  });

  it("keeps the strong theme colour out of the page-active (aria-current) rule", () => {
    const soft = css.match(/\.nav-pill\[aria-current="page"\][^{]*\{([^}]*)\}/)?.[1] ?? "";
    expect(soft).toContain("color-mix(");
    expect(soft).not.toMatch(/background:\s*var\(--accent\)\s*;/);
  });

  it("fades each pill-row edge only while there is more to scroll to on that side", () => {
    expect(css).toContain(".nav-pills[data-more-start]::before");
    expect(css).toContain(".nav-pills[data-more-end]::after");
    const base = css.match(/\.nav-pills::before,\s*\.nav-pills::after\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(base).toContain("opacity: 0");
    expect(base).toContain("pointer-events: none");
  });

  it("uses theme tokens only (no raw colours)", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  });
});
