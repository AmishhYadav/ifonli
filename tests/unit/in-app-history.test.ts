import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Env {
  referrer?: string;
  navType?: string;
  stored?: string;
  historyLength?: number;
  storageThrows?: boolean;
}

/** Loads a fresh copy of the module (it keeps per-document state) against a fake window/document. */
async function load(env: Env = {}) {
  const store: Record<string, string> = env.stored ? { ifonli_inapp: env.stored } : {};
  vi.stubGlobal("document", { referrer: env.referrer ?? "" });
  vi.spyOn(performance, "getEntriesByType").mockImplementation((() => (env.navType ? [{ type: env.navType }] : [])) as never);
  vi.stubGlobal("window", {
    location: { origin: "https://shop.example" },
    history: { length: env.historyLength ?? 3 },
    sessionStorage: {
      getItem: (k: string) => {
        if (env.storageThrows) throw new Error("denied");
        return store[k] ?? null;
      },
      setItem: (k: string, v: string) => {
        if (env.storageThrows) throw new Error("denied");
        store[k] = v;
      },
    },
  });
  vi.resetModules();
  return { mod: await import("@/features/navigation/in-app-history"), store };
}

describe("in-app history flag", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is false for a visitor who arrived from outside or typed the URL", async () => {
    expect((await load({ referrer: "" })).mod.hasInAppPrevious()).toBe(false);
    expect((await load({ referrer: "https://www.google.com/" })).mod.hasInAppPrevious()).toBe(false);
  });

  it("is true when the page was opened from another page of the same origin", async () => {
    const { mod } = await load({ referrer: "https://shop.example/types/charms" });
    expect(mod.hasInAppPrevious()).toBe(true);
  });

  it("needs something to go back to (a new tab has a referrer but a one-entry history)", async () => {
    const { mod } = await load({ referrer: "https://shop.example/shop", historyLength: 1 });
    expect(mod.hasInAppPrevious()).toBe(false);
  });

  it("becomes true after a client-side navigation, whatever the first referrer was", async () => {
    const { mod, store } = await load({ referrer: "https://www.google.com/" });
    mod.seedInAppHistory();
    expect(mod.hasInAppPrevious()).toBe(false);
    mod.markInAppNavigation();
    expect(mod.hasInAppPrevious()).toBe(true);
    expect(store.ifonli_inapp).toBe("1");
  });

  it("a reload keeps the answer for this tab", async () => {
    expect((await load({ navType: "reload", stored: "1" })).mod.hasInAppPrevious()).toBe(true);
    expect((await load({ navType: "reload", stored: "0", referrer: "https://shop.example/x" })).mod.hasInAppPrevious()).toBe(false);
  });

  it("survives blocked sessionStorage", async () => {
    const { mod } = await load({ referrer: "https://shop.example/shop", storageThrows: true });
    expect(mod.hasInAppPrevious()).toBe(true);
  });
});
