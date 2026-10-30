import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { getDb } from "@/server/db";
import { adminAuditLog, inventoryMovements, user, variants } from "@/server/db/schema";
import { adjustVariantStock, inventoryCsv, listInventory } from "@/server/services/admin/inventory";
import { InsufficientStockError } from "@/server/services/inventory";

import { seedCatalogFixture } from "./catalog-fixture";

const owner = { id: "owner-1", role: "owner" };
const fulfilment = { id: "ful-1", role: "fulfilment" };

async function setup() {
  await getDb()
    .insert(user)
    .values([
      { id: "owner-1", name: "Owner", email: "owner@example.com", role: "owner" },
      { id: "ful-1", name: "Packer", email: "ful@example.com", role: "fulfilment" },
    ]);
  return seedCatalogFixture();
}

describe("admin inventory", () => {
  it("lists variants with available/reserved and filters low and out of stock", async () => {
    const f = await setup();
    const all = await listInventory(getDb());
    expect(all.length).toBeGreaterThan(3);
    const skull = all.find((r) => r.variantId === f.variants.skull)!;
    expect(skull).toMatchObject({ onHand: 10, reserved: 0, available: 10, state: "in" });
    const out = await listInventory(getDb(), { filter: "out" });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((r) => r.available === 0)).toBe(true);
    const low = await listInventory(getDb(), { filter: "low" });
    expect(low.every((r) => r.state === "low" && r.available > 0)).toBe(true);
    expect(await listInventory(getDb(), { q: "no-such-sku-xyz" })).toEqual([]);
  });

  it("adjusts through the ledger with an audit row, and refuses going below zero", async () => {
    const f = await setup();
    const variantId = f.variants.skull!;
    const res = await adjustVariantStock(
      getDb(),
      { variantId, delta: 5, reason: "restock", note: "PO 42" },
      owner,
    );
    expect(res).toMatchObject({ previousQty: 10, newQty: 15 });
    const [row] = await getDb().select().from(variants).where(eq(variants.id, variantId));
    expect(row?.stockOnHand).toBe(15);
    const moves = await getDb()
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.variantId, variantId));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      delta: 5,
      reason: "restock",
      actorId: "owner-1",
      note: "PO 42",
    });
    const [audit] = await getDb()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "stock.adjust"));
    expect(audit?.diff).toMatchObject({ from: 10, to: 15, delta: 5 });

    await expect(
      adjustVariantStock(
        getDb(),
        { variantId, delta: -99, reason: "adjust", note: "recount" },
        owner,
      ),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect(
      (await getDb().select().from(variants).where(eq(variants.id, variantId)))[0]?.stockOnHand,
    ).toBe(15);
  });

  it("validates input: non-zero integers, note required for adjust/correction", async () => {
    const f = await setup();
    const variantId = f.variants.skull!;
    await expect(
      adjustVariantStock(getDb(), { variantId, delta: 0, reason: "restock" }, owner),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      adjustVariantStock(getDb(), { variantId, delta: 1.5, reason: "restock" }, owner),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      adjustVariantStock(getDb(), { variantId, delta: 1, reason: "sale" }, owner),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      adjustVariantStock(getDb(), { variantId, delta: -1, reason: "adjust" }, owner),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("denies the fulfilment role", async () => {
    const f = await setup();
    await expect(
      adjustVariantStock(
        getDb(),
        { variantId: f.variants.skull!, delta: 1, reason: "restock" },
        fulfilment,
      ),
    ).rejects.toThrow(/Forbidden/);
    expect(await getDb().select().from(inventoryMovements)).toHaveLength(0);
  });

  it("exports CSV with escaping and a formula guard", () => {
    const csv = inventoryCsv([
      {
        variantId: "1",
        sku: "=CMD()",
        variantTitle: 'Pink, "big"',
        productId: "p",
        productName: "Heart",
        productSlug: "heart",
        productStatus: "active",
        active: true,
        onHand: 3,
        reserved: 1,
        available: 2,
        threshold: 5,
        state: "low",
      },
    ]);
    const [header, line] = csv.trim().split("\r\n");
    expect(header).toBe(
      "Product,Variant,SKU,Status,On hand,Reserved,Available,Low-stock threshold,State",
    );
    expect(line).toBe('Heart,"Pink, ""big""",\'=CMD(),active,3,1,2,5,low');
  });
});
