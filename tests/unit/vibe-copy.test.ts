import { describe, expect, it } from "vitest";

import { VIBES } from "@/features/vibe/config";
import { COPY, COPY_KEYS } from "@/features/vibe/copy";

describe("copy dictionaries", () => {
  it("every vibe has exactly the same keys", () => {
    const expected = [...COPY_KEYS].sort();
    for (const v of VIBES) expect(Object.keys(COPY[v]).sort(), v).toEqual(expected);
  });

  it("every string is non-empty and trimmed", () => {
    for (const v of VIBES) {
      for (const k of COPY_KEYS) {
        const text = COPY[v][k];
        expect(text.trim().length, `${v}.${k}`).toBeGreaterThan(0);
        expect(text, `${v}.${k}`).toBe(text.trim());
      }
    }
  });

  it("copy differs between vibes for the hero headline (tone is per vibe)", () => {
    const headlines = new Set(VIBES.map((v) => COPY[v]["hero.headline"]));
    expect(headlines.size).toBe(VIBES.length);
  });

  it("avoids urgency and scarcity phrasing (plan section 3 dark-pattern rules)", () => {
    const banned =
      /(hurry|last chance|only \d+ left|selling fast|ends (soon|today)|don'?t miss|no thanks, i)/i;
    for (const v of VIBES)
      for (const k of COPY_KEYS) expect(COPY[v][k], `${v}.${k}`).not.toMatch(banned);
  });
});
