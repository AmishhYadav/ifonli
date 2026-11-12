import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `wearWithoutSaving`: the landing page's Mochi, which must never reach the cookie or storage. */
function setup(saved: { cookie?: string; storage?: string }) {
  const dataset: Record<string, string> = { vibe: saved.cookie ? saved.cookie.split("=")[1]! : "cute" };
  const writes: string[] = [];
  const doc = {
    documentElement: { dataset },
    get cookie() {
      return saved.cookie ?? "";
    },
    set cookie(value: string) {
      writes.push(`cookie:${value}`);
    },
    querySelector: () => null,
    createElement: () => ({}),
    head: { appendChild: () => {} },
  };
  const storage = {
    getItem: () => saved.storage ?? null,
    setItem: (_k: string, v: string) => writes.push(`storage:${v}`),
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", { localStorage: storage, location: { protocol: "https:" } });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  return { dataset, writes };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("wearWithoutSaving", () => {
  it("wears the vibe, writes nothing, and puts the saved cookie vibe back on undo", async () => {
    const { dataset, writes } = setup({ cookie: "ifonli_vibe=gothic" });
    const { wearWithoutSaving } = await import("@/features/vibe/store");
    const undo = wearWithoutSaving("cute");
    expect(dataset.vibe).toBe("cute");
    undo();
    expect(dataset.vibe).toBe("gothic");
    expect(writes).toEqual([]);
  });

  it("falls back to localStorage, then to the default vibe", async () => {
    const fromStorage = setup({ storage: "bold" });
    let mod = await import("@/features/vibe/store");
    mod.wearWithoutSaving("cute")();
    expect(fromStorage.dataset.vibe).toBe("bold");

    vi.resetModules();
    const nothing = setup({});
    mod = await import("@/features/vibe/store");
    nothing.dataset.vibe = "funky";
    mod.wearWithoutSaving("cute")();
    expect(nothing.dataset.vibe).toBe("cute");
  });

  it("ignores a junk saved value", async () => {
    const { dataset } = setup({ cookie: "ifonli_vibe=zzz", storage: "yyy" });
    dataset.vibe = "cute";
    const { wearWithoutSaving } = await import("@/features/vibe/store");
    wearWithoutSaving("cute")();
    expect(dataset.vibe).toBe("cute");
  });
});
