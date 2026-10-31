import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { renderTemplate, type TemplateContext } from "@/server/content/render-template";

const source = readFileSync(path.resolve(process.cwd(), "content/policies/privacy.md"), "utf8");

// Only the analytics key matters for this check; unrelated tokens are reported as problems and ignored.
const render = (ga4: string | null) => {
  const ctx: TemplateContext = { ga4_measurement_id: { value: ga4, blocking: false } };
  return renderTemplate(source, ctx).text;
};

describe("privacy policy matches what the site does", () => {
  it("always discloses the anonymous visit counter, with or without Google Analytics", () => {
    for (const ga4 of [null, "G-ABC123"]) {
      const text = render(ga4);
      expect(text).toContain("Visit counter (session storage and a session cookie)");
      expect(text).toContain("random code");
    }
  });

  it("mentions Google Analytics and the cookie settings link only when GA4 is configured", () => {
    expect(render(null)).not.toContain("Google Analytics 4");
    const withGa = render("G-ABC123");
    expect(withGa).toContain("Google Analytics 4");
    expect(withGa).toContain("cookie settings link in the footer");
  });

  it("keeps the cookie table intact around the conditional block", () => {
    const rows = (t: string) => t.split("\n").filter((l) => l.startsWith("| ") && l.includes("Cookie choice"));
    expect(rows(render(null))).toHaveLength(1);
    expect(rows(render("G-ABC123"))).toHaveLength(1);
    // the paragraph is separated from the table by a blank line, so Markdown does not swallow it into the table
    expect(render("G-ABC123")).toMatch(/\| Cookie choice[^\n]*\|\n\n\*\*Optional/);
  });
});
