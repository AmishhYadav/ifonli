import { describe, expect, it } from "vitest";

import { DISPLAY_FONT_FILES, VIBES, type Vibe } from "@/features/vibe/config";
import { buildHeadScript } from "@/features/vibe/headScript";
import { resolveTokens } from "@/features/vibe/tokens";

interface Env {
  search?: string;
  cookie?: string;
  storage?: string | null;
  storageThrows?: boolean;
  random?: number;
}

/** Runs the real head script against a tiny fake DOM. */
function run(script: string, env: Env = {}) {
  const head: Array<Record<string, string>> = [];
  const doc = {
    cookie: env.cookie ?? "",
    documentElement: { dataset: {} as Record<string, string> },
    head: { appendChild: (el: Record<string, string>) => head.push(el) },
    createElement: (tag: string) => ({ tag }) as Record<string, string>,
  };
  const store: Record<string, string> = env.storage ? { ifonli_vibe: env.storage } : {};
  const localStorage = {
    getItem: (k: string) => {
      if (env.storageThrows) throw new Error("denied");
      return store[k] ?? null;
    },
    setItem: (k: string, v: string) => {
      if (env.storageThrows) throw new Error("denied");
      store[k] = v;
    },
  };
  const location = { search: env.search ?? "", protocol: "https:" };
  const realRandom = Math.random;
  if (env.random !== undefined) Math.random = () => env.random!;
  try {
    new Function("document", "location", "localStorage", script)(doc, location, localStorage);
  } finally {
    Math.random = realRandom;
  }
  return { doc, head, store, vibe: doc.documentElement.dataset.vibe };
}

describe("head script", () => {
  const script = buildHeadScript();

  it("stays under 1 KB", () => {
    expect(new TextEncoder().encode(script).length).toBeLessThan(1024);
  });

  it("is a single IIFE with no template leftovers", () => {
    expect(script.startsWith("(function(){")).toBe(true);
    expect(script).not.toMatch(/\$\{|undefined/);
  });

  it("falls back to the default vibe and does not persist it", () => {
    const r = run(script);
    expect(r.vibe).toBe("cute");
    expect(r.doc.cookie).toBe("");
    expect(r.store).toEqual({});
  });

  it("?vibe= wins over cookie and storage, and is persisted", () => {
    const r = run(script, {
      search: "?vibe=gothic&x=1",
      cookie: "ifonli_vibe=bold",
      storage: "funky",
    });
    expect(r.vibe).toBe("gothic");
    expect(r.doc.cookie).toMatch(
      /^ifonli_vibe=gothic;max-age=31536000;path=\/;SameSite=Lax;Secure$/,
    );
    expect(r.store.ifonli_vibe).toBe("gothic");
  });

  it("cookie wins over localStorage", () => {
    const r = run(script, { cookie: "a=1; ifonli_vibe=bold; b=2", storage: "funky" });
    expect(r.vibe).toBe("bold");
  });

  it("uses localStorage when there is no URL param or cookie", () => {
    expect(run(script, { storage: "funky" }).vibe).toBe("funky");
  });

  it("ignores invalid values at every level", () => {
    const r = run(script, { search: "?vibe=nope", cookie: "ifonli_vibe=zzz", storage: "yyy" });
    expect(r.vibe).toBe("cute");
  });

  it("survives blocked localStorage", () => {
    const r = run(script, { search: "?vibe=bold", storageThrows: true });
    expect(r.vibe).toBe("bold");
  });

  it("preloads the active display font and sets theme-color to the vibe bg", () => {
    for (const v of VIBES) {
      const r = run(script, { search: `?vibe=${v}` });
      const link = r.head.find((e) => e.tag === "link");
      const meta = r.head.find((e) => e.tag === "meta");
      expect(link).toMatchObject({
        rel: "preload",
        as: "font",
        type: "font/woff2",
        crossOrigin: "",
      });
      expect(link?.href).toBe(DISPLAY_FONT_FILES[v]);
      expect(meta?.name).toBe("theme-color");
      expect(meta?.content).toBe(resolveTokens(v).palette.bg.toLowerCase());
    }
  });

  it("honours a custom default and cycle (settings-driven)", () => {
    const custom = buildHeadScript({ cycle: ["gothic", "funky"], defaultVibe: "funky" });
    expect(run(custom).vibe).toBe("funky");
    expect(run(custom, { search: "?vibe=cute" }).vibe).toBe("funky"); // not in cycle
    expect(run(custom, { search: "?vibe=gothic" }).vibe).toBe("gothic");
  });

  it('"random" default picks a cycle member and persists it', () => {
    const random = buildHeadScript({ defaultVibe: "random" });
    const picks = new Set<Vibe | undefined>();
    for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
      const out = run(random, { random: r });
      picks.add(out.vibe as Vibe);
      expect(out.store.ifonli_vibe).toBe(out.vibe);
    }
    expect(picks.size).toBe(VIBES.length);
    // A stored value still beats random.
    expect(run(random, { storage: "gothic", random: 0 }).vibe).toBe("gothic");
  });
});

describe("head script with a default vibe outside the cycle", () => {
  it("falls back to the first vibe of the cycle and still sets the font preload and theme colour", () => {
    const script = buildHeadScript({ cycle: ["bold", "funky"], defaultVibe: "gothic" });
    const r = run(script);
    expect(r.vibe).toBe("bold");
    expect(r.head.map((el) => el.tag)).toEqual(["link", "meta"]);
  });
});
