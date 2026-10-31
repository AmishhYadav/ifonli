import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WishlistEntry } from "@/features/wishlist/list";
import {
  clearWishlistLocal,
  getWishlist,
  mergeIntoWishlist,
  replaceWishlistLocal,
  resetWishlistStoreForTests,
  toggleWishlist,
} from "@/features/wishlist/store";
import { registerWishlistSync, type WishlistSync } from "@/features/wishlist/sync";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function fakeSync(account: WishlistEntry[] = []) {
  const pushed: WishlistEntry[][] = [];
  const sync: WishlistSync = {
    pull: async () => account,
    push: async (entries) => {
      pushed.push([...entries]);
    },
  };
  return { sync, pushed };
}

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
  resetWishlistStoreForTests();
});

afterEach(() => {
  registerWishlistSync(null);
  vi.unstubAllGlobals();
});

describe("wishlist store with the account sync registered", () => {
  it("pushes every local change", () => {
    const { sync, pushed } = fakeSync();
    registerWishlistSync(sync);
    toggleWishlist(id(1), 10);
    toggleWishlist(id(2), 20);
    toggleWishlist(id(1), 30); // removal
    expect(pushed.map((list) => list.map((e) => e.id))).toEqual([[id(1)], [id(2), id(1)], [id(2)]]);
  });

  it("sign-in merge: the account list is unioned into the device list and pushed back", () => {
    toggleWishlist(id(1), 100); // a guest heart, before signing in
    const { sync, pushed } = fakeSync();
    registerWishlistSync(sync);
    mergeIntoWishlist([
      { id: id(2), addedAt: 50 },
      { id: id(1), addedAt: 40 },
    ]);
    expect(getWishlist().map((e) => e.id)).toEqual([id(2), id(1)]);
    expect(getWishlist().find((e) => e.id === id(1))!.addedAt).toBe(40);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.map((e) => e.id).sort()).toEqual([id(1), id(2)].sort());
  });

  it("following the account (replace) and signing out (clear) never push", () => {
    const { sync, pushed } = fakeSync();
    registerWishlistSync(sync);
    toggleWishlist(id(1), 1);
    pushed.length = 0;

    replaceWishlistLocal([{ id: id(5), addedAt: 5 }]);
    expect(getWishlist().map((e) => e.id)).toEqual([id(5)]);
    clearWishlistLocal();
    expect(getWishlist()).toEqual([]);
    expect(pushed).toEqual([]);
  });

  it("stays device-only without a registered sync", () => {
    expect(toggleWishlist(id(1), 1)).toBe(true);
    expect(getWishlist()).toHaveLength(1);
  });
});
