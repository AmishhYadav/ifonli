import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { WISHLIST_MAX_ITEMS } from "@/features/wishlist/list";
import { getDb } from "@/server/db";
import { user, wishlistItems } from "@/server/db/schema";
import {
  getAccountWishlist,
  mergeIntoAccountWishlist,
  replaceAccountWishlist,
} from "@/server/services/wishlist";

import { makeProduct } from "./helpers/factories";

const db = () => getDb();
const T = Date.UTC(2026, 9, 1);

beforeEach(async () => {
  await db()
    .insert(user)
    .values([
      { id: "cust-a", name: "Asha", email: "asha@example.com" },
      { id: "cust-b", name: "Bela", email: "bela@example.com" },
    ]);
});

describe("account wishlist sync", () => {
  it("pushes the device list (replace) and pulls it back newest first", async () => {
    const [p1, p2, p3] = [await makeProduct(), await makeProduct(), await makeProduct()];
    const stored = await replaceAccountWishlist(db(), "cust-a", [
      { id: p1.id, addedAt: T },
      { id: p2.id, addedAt: T + 2000 },
      { id: p3.id, addedAt: T + 1000 },
    ]);
    expect(stored.map((e) => e.id)).toEqual([p2.id, p3.id, p1.id]);
    expect((await getAccountWishlist(db(), "cust-a")).map((e) => e.id)).toEqual([p2.id, p3.id, p1.id]);
    expect(stored.find((e) => e.id === p1.id)!.addedAt).toBe(T);

    // a removal on the device sticks: replace drops the rows that are not in the new list
    await replaceAccountWishlist(db(), "cust-a", [{ id: p2.id, addedAt: T + 2000 }]);
    expect((await getAccountWishlist(db(), "cust-a")).map((e) => e.id)).toEqual([p2.id]);
    await replaceAccountWishlist(db(), "cust-a", []);
    expect(await getAccountWishlist(db(), "cust-a")).toEqual([]);
  });

  it("merges the device list into the account on sign-in (union, earliest save time wins)", async () => {
    const [p1, p2, p3] = [await makeProduct(), await makeProduct(), await makeProduct()];
    await replaceAccountWishlist(db(), "cust-a", [
      { id: p1.id, addedAt: T + 500 },
      { id: p2.id, addedAt: T + 100 },
    ]);
    const merged = await mergeIntoAccountWishlist(db(), "cust-a", [
      { id: p2.id, addedAt: T + 9000 }, // already saved, later: keep the account's earlier time
      { id: p3.id, addedAt: T + 7000 },
    ]);
    expect(merged.map((e) => e.id).sort()).toEqual([p1.id, p2.id, p3.id].sort());
    expect(merged.find((e) => e.id === p2.id)!.addedAt).toBe(T + 100);
    expect(merged.map((e) => e.id)[0]).toBe(p3.id);
  });

  it("keeps lists per customer", async () => {
    const p = await makeProduct();
    await replaceAccountWishlist(db(), "cust-a", [{ id: p.id, addedAt: T }]);
    expect(await getAccountWishlist(db(), "cust-b")).toEqual([]);
    await replaceAccountWishlist(db(), "cust-b", []);
    expect(await getAccountWishlist(db(), "cust-a")).toHaveLength(1);
  });

  it("ignores junk: unknown product ids, malformed entries, duplicates", async () => {
    const p = await makeProduct();
    const stored = await replaceAccountWishlist(db(), "cust-a", [
      { id: p.id, addedAt: T },
      { id: p.id, addedAt: T + 1 },
      { id: "00000000-0000-4000-8000-000000000000", addedAt: T },
      { id: "not-a-uuid", addedAt: T },
      null,
      "x",
    ]);
    expect(stored.map((e) => e.id)).toEqual([p.id]);
    expect(await replaceAccountWishlist(db(), "cust-a", "nonsense")).toEqual([]);
  });

  it("respects the maximum list size, dropping the oldest", async () => {
    const entries = [];
    for (let i = 0; i < WISHLIST_MAX_ITEMS + 5; i++) {
      const p = await makeProduct();
      entries.push({ id: p.id, addedAt: T + i * 1000 });
    }
    const stored = await replaceAccountWishlist(db(), "cust-a", entries);
    expect(stored).toHaveLength(WISHLIST_MAX_ITEMS);
    // the five oldest fell off
    const oldest = new Set(entries.slice(0, 5).map((e) => e.id));
    expect(stored.some((e) => oldest.has(e.id))).toBe(false);
    expect(await db().select().from(wishlistItems).where(eq(wishlistItems.userId, "cust-a"))).toHaveLength(
      WISHLIST_MAX_ITEMS,
    );
  });
});
