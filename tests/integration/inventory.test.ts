import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { inventoryMovements, products, stockReservations, user, variants } from "@/server/db/schema";
import {
  InsufficientStockError,
  InvalidStockAdjustmentError,
  VariantNotFoundError,
  adjustStock,
  getVariantAvailability,
  ledgerFor,
  listLowStock,
} from "@/server/services/inventory";

import { makeOrder, reserve, seedCatalogFixture } from "./catalog-fixture";

const db = () => getDb();

async function stockOf(variantId: string) {
  const [row] = await db().select().from(variants).where(eq(variants.id, variantId));
  return row!.stockOnHand;
}

async function makeActor() {
  const [u] = await db()
    .insert(user)
    .values({ id: "admin-1", name: "Admin", email: "admin@example.com", role: "admin" })
    .returning();
  return u!.id;
}

describe("getVariantAvailability", () => {
  it("subtracts active unexpired reservations only", async () => {
    const f = await seedCatalogFixture();
    const v = f.variants.skull!; // 10 on hand
    await reserve(v, 3, 10); // counts
    await reserve(v, 4, -1); // expired: ignored
    for (const status of ["converted", "released"] as const) {
      // One order per row: (order, variant) is unique.
      const order = await makeOrder();
      await db()
        .insert(stockReservations)
        .values({ orderId: order.id, variantId: v, qty: 2, expiresAt: new Date(Date.now() + 600_000), status });
    }
    expect(await getVariantAvailability([v])).toEqual([{ variantId: v, onHand: 10, available: 7 }]);
  });

  it("never goes below zero, skips unknown ids, handles an empty list", async () => {
    const f = await seedCatalogFixture();
    await reserve(f.variants.cat!, 99, 10); // more than on hand
    const r = await getVariantAvailability([f.variants.cat!, "00000000-0000-0000-0000-000000000000"]);
    expect(r).toEqual([{ variantId: f.variants.cat, onHand: 3, available: 0 }]);
    expect(await getVariantAvailability([])).toEqual([]);
  });

  it("works inside a transaction, with row locking", async () => {
    const f = await seedCatalogFixture();
    const out = await db().transaction((tx) =>
      getVariantAvailability([f.variants.skull!, f.variants.cat!], tx, { lock: true }),
    );
    expect(out.map((r) => r.available).sort((a, b) => a - b)).toEqual([3, 10]);
  });
});

describe("adjustStock", () => {
  it("updates stock and writes the ledger row atomically", async () => {
    const f = await seedCatalogFixture();
    const actorId = await makeActor();
    const res = await adjustStock({
      variantId: f.variants.skull!,
      delta: 5,
      reason: "restock",
      actorId,
      note: "new batch",
    });
    expect(res).toMatchObject({ delta: 5, previousQty: 10, newQty: 15 });
    expect(await stockOf(f.variants.skull!)).toBe(15);

    const order = await makeOrder();
    await adjustStock({ variantId: f.variants.skull!, delta: -2, reason: "sale", actorId: null, orderId: order.id });
    expect(await stockOf(f.variants.skull!)).toBe(13);

    const ledger = await ledgerFor(f.variants.skull!);
    expect(ledger).toHaveLength(2);
    // newest first by created_at; same-tx timestamps differ because each call is its own tx
    expect(ledger.map((l) => [l.delta, l.reason]).sort()).toEqual([
      [-2, "sale"],
      [5, "restock"],
    ]);
    const restock = ledger.find((l) => l.reason === "restock")!;
    expect(restock).toMatchObject({ actorId, note: "new batch", orderId: null });
    expect(ledger.find((l) => l.reason === "sale")!.orderId).toBe(order.id);
  });

  it("rejects going negative with a typed error and changes nothing", async () => {
    const f = await seedCatalogFixture();
    const v = f.variants.cat!; // 3 on hand
    const err = await adjustStock({ variantId: v, delta: -4, reason: "adjust", actorId: null }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientStockError);
    expect(err).toMatchObject({ variantId: v, delta: -4, onHand: 3 });
    expect(await stockOf(v)).toBe(3);
    expect(await ledgerFor(v)).toEqual([]);
    // exactly to zero is fine
    await adjustStock({ variantId: v, delta: -3, reason: "adjust", actorId: null });
    expect(await stockOf(v)).toBe(0);
  });

  it("rejects invalid deltas and unknown variants", async () => {
    const f = await seedCatalogFixture();
    for (const delta of [0, 1.5, Number.NaN]) {
      await expect(
        adjustStock({ variantId: f.variants.cat!, delta, reason: "adjust", actorId: null }),
      ).rejects.toBeInstanceOf(InvalidStockAdjustmentError);
    }
    await expect(
      adjustStock({
        variantId: "00000000-0000-0000-0000-000000000000",
        delta: 1,
        reason: "adjust",
        actorId: null,
      }),
    ).rejects.toBeInstanceOf(VariantNotFoundError);
  });

  it("joins the caller's transaction (rolls back with it)", async () => {
    const f = await seedCatalogFixture();
    const v = f.variants.skull!;
    await expect(
      db().transaction(async (tx) => {
        await adjustStock({ variantId: v, delta: -4, reason: "sale", actorId: null }, tx);
        expect(await stockOf(v)).toBe(10); // other connection does not see it yet
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await stockOf(v)).toBe(10);
    expect(await ledgerFor(v)).toEqual([]);

    await db().transaction(async (tx) => {
      await adjustStock({ variantId: v, delta: -4, reason: "sale", actorId: null }, tx);
    });
    expect(await stockOf(v)).toBe(6);
    expect(await ledgerFor(v)).toHaveLength(1);
  });

  it("two parallel decrements of the last unit: exactly one succeeds", async () => {
    const f = await seedCatalogFixture();
    const v = f.variants.skull!;
    await db().update(variants).set({ stockOnHand: 1 }).where(eq(variants.id, v));
    const results = await Promise.allSettled([
      adjustStock({ variantId: v, delta: -1, reason: "sale", actorId: null }),
      adjustStock({ variantId: v, delta: -1, reason: "sale", actorId: null }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(InsufficientStockError);
    expect(await stockOf(v)).toBe(0);
    expect(await ledgerFor(v)).toHaveLength(1);
  });

  it("many parallel decrements never oversell and the ledger matches stock", async () => {
    const f = await seedCatalogFixture();
    const v = f.variants.ghost!; // 20 on hand
    const attempts = 30;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () =>
        adjustStock({ variantId: v, delta: -1, reason: "sale", actorId: null }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(20);
    expect(await stockOf(v)).toBe(0);
    const ledger = await db().select().from(inventoryMovements).where(eq(inventoryMovements.variantId, v));
    expect(ledger.reduce((sum, m) => sum + m.delta, 0)).toBe(-20);
  });
});

describe("listLowStock", () => {
  it("lists active variants at or below threshold (override else setting), lowest first", async () => {
    const f = await seedCatalogFixture();
    // default threshold 5: cat (3), heart pink (5), heart red (0)
    const rows = await listLowStock();
    expect(rows.map((r) => [r.sku, r.available, r.threshold])).toEqual([
      ["HT-RED", 0, 5],
      ["CT-1", 3, 5],
      ["HT-PINK", 5, 5],
    ]);
    expect(rows[0]).toMatchObject({ productName: "Heart Charm", productSlug: "heart-charm", onHand: 0 });

    // per-variant override raises the bar for Spiky (7 on hand)
    await db().update(variants).set({ lowStockThreshold: 8 }).where(eq(variants.id, f.variants.spiky!));
    // reservations count: Skull 10 on hand, 6 reserved -> 4 available <= 5
    await reserve(f.variants.skull!, 6, 10);
    const rows2 = await listLowStock();
    expect(rows2.map((r) => r.sku)).toEqual(["HT-RED", "CT-1", "SK-1", "HT-PINK", "SP-1"]);
  });

  it("excludes inactive variants and archived products", async () => {
    const f = await seedCatalogFixture();
    await db().update(variants).set({ active: false }).where(eq(variants.id, f.variants.cat!));
    await db().update(products).set({ status: "archived" }).where(eq(products.id, f.products["heart-charm"]!));
    expect(await listLowStock()).toEqual([]);
  });
});

describe("ledgerFor", () => {
  it("returns newest first and honours limit/offset", async () => {
    const f = await seedCatalogFixture();
    const v = f.variants.skull!;
    for (const delta of [1, 2, 3]) {
      await adjustStock({ variantId: v, delta, reason: "restock", actorId: null });
    }
    expect((await ledgerFor(v)).map((l) => l.delta)).toEqual([3, 2, 1]);
    expect((await ledgerFor(v, { limit: 2 })).map((l) => l.delta)).toEqual([3, 2]);
    expect((await ledgerFor(v, { limit: 2, offset: 2 })).map((l) => l.delta)).toEqual([1]);
    expect(await ledgerFor(f.variants.cat!)).toEqual([]);
  });
});
