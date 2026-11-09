import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_VIBE_CYCLE } from "@/features/vibe/config";

/** `warmOtherVibeFonts` against a fake `document.fonts`: which display fonts are fetched, in what order. */
async function load(connection?: { saveData?: boolean; effectiveType?: string }) {
  const loaded: string[] = [];
  vi.stubGlobal("document", {
    fonts: { load: (d: string) => (loaded.push(d), Promise.resolve([])) },
  });
  vi.stubGlobal("navigator", { connection });
  vi.stubGlobal("window", {
    requestIdleCallback: (cb: () => void) => setTimeout(cb, 0),
    setTimeout: globalThis.setTimeout,
  });
  vi.resetModules();
  const mod = await import("@/features/vibe/switch");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
  return { mod, loaded, settle };
}

describe("warming the other vibes' display fonts", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("fetches every other vibe's display font, the next click's first, never the one already on screen", async () => {
    const { mod, loaded, settle } = await load();
    mod.warmOtherVibeFonts("bold", DEFAULT_VIBE_CYCLE);
    await settle();
    expect(loaded).toEqual(['600 1em "Fredoka"', '400 1em "Creepster"', '400 1em "Rubik Glitch"']);
  });

  it("fetches each font once, however often it is asked", async () => {
    const { mod, loaded, settle } = await load();
    mod.warmOtherVibeFonts("cute", DEFAULT_VIBE_CYCLE);
    await settle();
    mod.warmOtherVibeFonts("gothic", DEFAULT_VIBE_CYCLE);
    await settle();
    expect(loaded).toHaveLength(4);
    expect(new Set(loaded).size).toBe(4);
  });

  it("warms only the next vibe on Save-Data", async () => {
    const { mod, loaded, settle } = await load({ saveData: true, effectiveType: "4g" });
    mod.warmOtherVibeFonts("cute", DEFAULT_VIBE_CYCLE);
    await settle();
    expect(loaded).toEqual(['400 1em "Creepster"']);
  });

  it("warms only the next vibe on a 2g-class connection", async () => {
    for (const effectiveType of ["2g", "slow-2g"]) {
      const { mod, loaded, settle } = await load({ effectiveType });
      mod.warmOtherVibeFonts("cute", DEFAULT_VIBE_CYCLE);
      await settle();
      expect(loaded).toEqual(['400 1em "Creepster"']);
    }
  });

  it("follows a custom cycle order", async () => {
    const { mod, loaded, settle } = await load();
    mod.warmOtherVibeFonts("cute", ["cute", "bold", "funky", "gothic"]);
    await settle();
    expect(loaded).toEqual([
      '400 1em "Bungee Shade"',
      '400 1em "Rubik Glitch"',
      '400 1em "Creepster"',
    ]);
  });
});
