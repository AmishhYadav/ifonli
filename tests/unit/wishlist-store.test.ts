import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WISHLIST_MAX_ITEMS,
  mergeWishlists,
  parseWishlist,
  pruneEntries,
  toggleEntry,
} from "@/features/wishlist/list";
import {
  WISHLIST_STORAGE_KEY,
  getWishlist,
  isInWishlist,
  pruneWishlist,
  resetWishlistStoreForTests,
  subscribeWishlist,
  toggleWishlist,
} from "@/features/wishlist/store";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("wishlist list helpers", () => {
  it("parses defensively and sorts newest first", () => {
    expect(parseWishlist(null)).toEqual([]);
    expect(parseWishlist("not json")).toEqual([]);
    expect(parseWishlist('{"a":1}')).toEqual([]);
    const raw = JSON.stringify([
      { id: id(1), addedAt: 10 },
      { id: "nope", addedAt: 99 },
      { id: id(2), addedAt: 30 },
      { id: id(1), addedAt: 50 },
      null,
    ]);
    expect(parseWishlist(raw).map((e) => e.id)).toEqual([id(2), id(1)]);
  });

  it("toggles on and off and caps the list", () => {
    const one = toggleEntry([], id(1), 5);
    expect(one).toEqual([{ id: id(1), addedAt: 5 }]);
    expect(toggleEntry(one, id(1), 6)).toEqual([]);
    let list = one;
    for (let n = 2; n < WISHLIST_MAX_ITEMS + 10; n++) list = toggleEntry(list, id(n), n);
    expect(list).toHaveLength(WISHLIST_MAX_ITEMS);
    expect(list[0]!.id).toBe(id(WISHLIST_MAX_ITEMS + 9));
  });

  it("prunes unknown ids and keeps the same array when nothing changes", () => {
    const list = [
      { id: id(1), addedAt: 2 },
      { id: id(2), addedAt: 1 },
    ];
    expect(pruneEntries(list, new Set([id(1)]))).toEqual([{ id: id(1), addedAt: 2 }]);
    expect(pruneEntries(list, new Set([id(1), id(2)]))).toBe(list);
  });

  it("merges device and account lists keeping the earliest save time", () => {
    const merged = mergeWishlists(
      [{ id: id(1), addedAt: 100 }],
      [
        { id: id(1), addedAt: 40 },
        { id: id(2), addedAt: 70 },
      ],
    );
    expect(merged).toEqual([
      { id: id(2), addedAt: 70 },
      { id: id(1), addedAt: 40 },
    ]);
  });
});

describe("wishlist device store", () => {
  const data = new Map<string, string>();
  beforeEach(() => {
    data.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, value: string) => void data.set(k, value),
    });
    resetWishlistStoreForTests();
  });

  it("persists toggles to localStorage and notifies subscribers", () => {
    const listener = vi.fn();
    const off = subscribeWishlist(listener);
    expect(isInWishlist(id(1))).toBe(false);
    expect(toggleWishlist(id(1), 1)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(JSON.parse(data.get(WISHLIST_STORAGE_KEY)!)).toEqual([{ id: id(1), addedAt: 1 }]);
    expect(toggleWishlist(id(1), 2)).toBe(false);
    off();
    toggleWishlist(id(2), 3);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("reads what a previous visit saved and returns a stable snapshot", () => {
    data.set(WISHLIST_STORAGE_KEY, JSON.stringify([{ id: id(7), addedAt: 9 }]));
    const first = getWishlist();
    expect(first).toEqual([{ id: id(7), addedAt: 9 }]);
    expect(getWishlist()).toBe(first);
  });

  it("forgets ids the catalogue no longer has", () => {
    toggleWishlist(id(1), 1);
    toggleWishlist(id(2), 2);
    pruneWishlist(new Set([id(2)]));
    expect(getWishlist().map((e) => e.id)).toEqual([id(2)]);
  });

  it("keeps working in memory when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    resetWishlistStoreForTests();
    expect(toggleWishlist(id(1), 1)).toBe(true);
    expect(isInWishlist(id(1))).toBe(true);
  });
});
