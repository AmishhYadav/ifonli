import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `switchVibeTo` against a minimal fake DOM: the site vibe lives on `documentElement.dataset.vibe`. */
async function load(opts: { reduced: boolean; viewTransitions: boolean; vibe?: string }) {
  const dataset: Record<string, string> = { vibe: opts.vibe ?? "cute" };
  const attrs = new Set<string>();
  const events: Array<{ detail: { from: string; to: string; source: string; usedViewTransition: boolean } }> = [];
  const doc: Record<string, unknown> = {
    documentElement: {
      dataset,
      setAttribute: (name: string) => attrs.add(name),
      removeAttribute: (name: string) => attrs.delete(name),
      hasAttribute: (name: string) => attrs.has(name),
    },
    querySelectorAll: () => [],
    cookie: "",
    head: { appendChild: () => {} },
    createElement: () => ({}),
    querySelector: () => null,
    getElementById: () => null,
    fonts: { load: () => Promise.resolve([]) },
  };
  if (opts.viewTransitions) {
    doc.startViewTransition = (cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    };
  }
  vi.stubGlobal("document", doc);
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
  vi.stubGlobal("CustomEvent", class { constructor(public type: string, public init: object) { Object.assign(this, init); } });
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: opts.reduced }),
    location: { href: "https://shop.example/shop", protocol: "https:" },
    history: { state: null, replaceState: () => {} },
    localStorage: { setItem: () => {} },
    setTimeout: globalThis.setTimeout,
    dispatchEvent: (e: (typeof events)[number]) => events.push(e),
  });
  vi.resetModules();
  const mod = await import("@/features/vibe/switch");
  return { mod, dataset, events, attrs };
}

describe("switchVibeTo", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("applies the vibe, navigates after it, and reports the source", async () => {
    const { mod, dataset, events } = await load({ reduced: false, viewTransitions: true });
    const order: string[] = [];
    await mod.switchVibeTo("funky", "nav", {
      navigate: () => order.push(`navigate:${dataset.vibe}`),
      onSettled: () => order.push("settled"),
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(dataset.vibe).toBe("funky");
    expect(order[0]).toBe("navigate:funky"); // the theme is already applied when the navigation starts
    expect(events[0]?.detail).toMatchObject({ from: "cute", to: "funky", source: "nav", usedViewTransition: true });
  });

  it("turns colour transitions off for the switch (data-vibe-switching) and back on after it settles", async () => {
    const { mod, dataset, attrs } = await load({ reduced: false, viewTransitions: true });
    const seen: boolean[] = [];
    await mod.switchVibeTo("funky", "hand", { navigate: () => seen.push(attrs.has("data-vibe-switching")) });
    expect(dataset.vibe).toBe("funky");
    expect(seen).toEqual([true]); // already set when the new theme is applied
    await new Promise((r) => setTimeout(r, 20));
    expect(attrs.has("data-vibe-switching")).toBe(false);
  });

  it("skips the view transition under reduced motion", async () => {
    const { mod, dataset, events } = await load({ reduced: true, viewTransitions: true });
    await mod.switchVibeTo("gothic", "hand");
    await new Promise((r) => setTimeout(r, 0));
    expect(dataset.vibe).toBe("gothic");
    expect(events[0]?.detail).toMatchObject({ source: "hand", usedViewTransition: false });
  });

  it("a switch to the vibe already worn only navigates", async () => {
    const { mod, events } = await load({ reduced: false, viewTransitions: true, vibe: "bold" });
    const navigate = vi.fn();
    await mod.switchVibeTo("bold", "nav", { navigate });
    expect(navigate).toHaveBeenCalledOnce();
    expect(events).toHaveLength(0);
  });
});
