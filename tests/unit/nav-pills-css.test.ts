import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(process.cwd(), "src/styles/nav-pills.css"), "utf8");

describe("nav pill states (styles/nav-pills.css)", () => {
  it("fills the pill of the current page (aria-current) and has no per-vibe pill rules left", () => {
    const active = css.match(/\.nav-pill\[aria-current="page"\][^{]*\{([^}]*)\}/)?.[1] ?? "";
    expect(active).toMatch(/background:\s*var\(--accent\)\s*;/);
    expect(active).toMatch(/color:\s*var\(--on-accent\)\s*;/);
    expect(css).not.toContain("data-nav-vibe");
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
