import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { getDb } from "@/server/db";
import { adminAuditLog, inventoryMovements, products, user, variants } from "@/server/db/schema";
import { adjustVariantStock, inventoryCsv, listInventory } from "@/server/services/admin/inventory";
import { applyInventoryImport, previewInventoryImport } from "@/server/services/admin/inventory-import";
import { AdminInputError } from "@/server/services/admin/products";

import { reserve, seedCatalogFixture } from "./catalog-fixture";

const owner = { id: "owner-1", role: "owner" };
const staff = { id: "ful-1", role: "fulfilment" };

/** Fixture stock: SK-1 10, HT-PINK 5, HT-RED 0, CT-1 3, GH-1 20, SP-1 7. */
async function setup() {
  await getDb()
    .insert(user)
    .values([
      { id: "owner-1", name: "Owner", email: "owner@example.com", role: "owner" },
      { id: "ful-1", name: "Packer", email: "ful@example.com", role: "fulfilment" },
    ]);
  return seedCatalogFixture();
}

const onHand = async (sku: string) =>
  (await getDb().select().from(variants).where(eq(variants.sku, sku)))[0]!.stockOnHand;
const moves = () => getDb().select().from(inventoryMovements);
const audits = () =>
  getDb().select().from(adminAuditLog).where(eq(adminAuditLog.action, "stock.import"));

describe("admin inventory import: preview", () => {
  it("shows old to new per SKU, units, and flags unknown, invalid, duplicate and negative lines", async () => {
    await setup();
    const text = [
      "SKU,On hand",
      "SK-1,15", // +5
      "CT-1,1", // -2
      "GH-1,20", // unchanged
      "NOPE-1,4", // unknown
      "HT-PINK,-2", // negative
      "SP-1,abc", // not a number
      "SK-1,3", // duplicate
    ].join("\n");
    const p = await previewInventoryImport(getDb(), { text, reason: "adjust" }, owner);
    expect(p.counts).toMatchObject({ lines: 7, changed: 2, unchanged: 1, increases: 1, decreases: 1, unitsAdded: 5, unitsRemoved: 2 });
    expect(p.changes.map((c) => [c.sku, c.from, c.to, c.delta])).toEqual([
      ["SK-1", 10, 15, 5],
      ["CT-1", 3, 1, -2],
    ]);
    expect(p.issues.total).toBe(4);
    expect(p.issues.items.map((i) => i.line)).toEqual([5, 6, 7, 8]);
    expect(p.issues.items[0]!.message).toMatch(/no variant/);
    expect(p.issues.items[1]!.message).toMatch(/negative/);
    expect(p.issues.items[2]!.message).toMatch(/whole number/);
    expect(p.issues.items[3]!.message).toMatch(/repeated/);
    expect(p.canApply).toBe(false);
    // Nothing written by a preview.
    expect(await onHand("SK-1")).toBe(10);
    expect(await moves()).toHaveLength(0);
    expect(await getDb().select().from(adminAuditLog)).toHaveLength(0);
  });

  it("refuses archived products, and a restock file that would lower stock", async () => {
    await setup();
    await getDb().update(products).set({ status: "archived" }).where(eq(products.slug, "retired-product"));
    const archived = await previewInventoryImport(getDb(), { text: "RT-1,5", reason: "adjust" }, owner);
    expect(archived.issues.items[0]!.message).toMatch(/archived/);
    const restock = await previewInventoryImport(getDb(), { text: "SK-1,4\nCT-1,9", reason: "restock" }, owner);
    expect(restock.issues.items).toHaveLength(1);
    expect(restock.issues.items[0]!.message).toMatch(/can only add/);
    expect(restock.changes.map((c) => c.sku)).toEqual(["CT-1"]);
  });

  it("warns when the new count is below what open checkouts hold", async () => {
    const f = await setup();
    await reserve(f.variants.skull!, 6, 15);
    const p = await previewInventoryImport(getDb(), { text: "SK-1,4", reason: "adjust" }, owner);
    expect(p.changes[0]).toMatchObject({ reserved: 6 });
    expect(p.changes[0]!.warning).toMatch(/6 held by open checkouts/);
    expect(p.canApply).toBe(true);
  });

  it("round-trips the inventory export", async () => {
    await setup();
    const csv = inventoryCsv(await listInventory(getDb()));
    const p = await previewInventoryImport(getDb(), { text: csv, reason: "adjust" }, owner);
    expect(p.issues.total).toBe(0);
    expect(p.counts.changed).toBe(0);
    expect(p.counts.unchanged).toBeGreaterThan(3);
    // Edit one On hand cell in the export and it shows as a change.
    const edited = csv.replace(/^(Skull Charm,[^\r\n]*?,SK-1,active,)10,/m, "$1" + "25,");
    const p2 = await previewInventoryImport(getDb(), { text: edited, reason: "adjust" }, owner);
    expect(p2.changes.map((c) => [c.sku, c.from, c.to])).toEqual([["SK-1", 10, 25]]);
  });
});

describe("admin inventory import: apply", () => {
  async function previewThenApply(text: string, extra: Record<string, unknown> = {}) {
    const p = await previewInventoryImport(getDb(), { text, reason: "adjust" }, owner);
    return applyInventoryImport(
      getDb(),
      { text, reason: "adjust", fileName: "count.csv", note: "October count", baseline: p.baseline, ...extra },
      owner,
    );
  }

  it("writes one ledger row per change, sets stock, and ONE audit row", async () => {
    const f = await setup();
    const res = await previewThenApply("SKU,On hand\nSK-1,15\nCT-1,1\nGH-1,20\n");
    expect(res.changed).toBe(2);
    expect(res.unchanged).toBe(1);
    expect(res.productIds).toHaveLength(2);
    expect(await onHand("SK-1")).toBe(15);
    expect(await onHand("CT-1")).toBe(1);
    expect(await onHand("GH-1")).toBe(20);

    const rows = await moves();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.variantId === f.variants.skull)).toMatchObject({
      delta: 5,
      reason: "adjust",
      actorId: "owner-1",
      note: "CSV import count.csv: October count",
    });
    const log = await audits();
    expect(log).toHaveLength(1);
    expect(log[0]!.diff).toMatchObject({
      file: "count.csv",
      reason: "adjust",
      changed: 2,
      unitsAdded: 5,
      unitsRemoved: 2,
      sample: [
        { sku: "SK-1", from: 10, to: 15 },
        { sku: "CT-1", from: 3, to: 1 },
      ],
    });
    // The manual-adjustment audit action is not used for imports.
    expect(await getDb().select().from(adminAuditLog).where(eq(adminAuditLog.action, "stock.adjust"))).toHaveLength(0);
  });

  it("is all or nothing: a problem line refuses the whole file", async () => {
    await setup();
    const p = await previewInventoryImport(getDb(), { text: "SK-1,15\nNOPE,1", reason: "adjust" }, owner);
    await expect(
      applyInventoryImport(getDb(), { text: "SK-1,15\nNOPE,1", reason: "adjust", baseline: p.baseline }, owner),
    ).rejects.toThrow(/1 problem line/);
    expect(await onHand("SK-1")).toBe(10);
    expect(await moves()).toHaveLength(0);
  });

  it("refuses the file when stock moved after the preview, naming the SKU, and writes nothing", async () => {
    const f = await setup();
    const text = "SK-1,15\nCT-1,1";
    const p = await previewInventoryImport(getDb(), { text, reason: "adjust" }, owner);
    // A manual adjustment (or a sale) lands between preview and apply.
    await adjustVariantStock(getDb(), { variantId: f.variants.skull, delta: -3, reason: "adjust", note: "sale on shelf" }, owner);
    const err = await applyInventoryImport(getDb(), { text, reason: "adjust", baseline: p.baseline }, owner).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdminInputError);
    expect((err as Error).message).toMatch(/SK-1 \(was 10, now 7\)/);
    expect(await onHand("SK-1")).toBe(7);
    expect(await onHand("CT-1")).toBe(3);
    expect(await audits()).toHaveLength(0);
    // Only the manual adjustment's ledger row exists.
    expect(await moves()).toHaveLength(1);
    // A fresh preview shows the new difference and applies.
    const res = await previewThenApply(text);
    expect(res.changed).toBe(2);
    expect(await onHand("SK-1")).toBe(15);
  });

  it("a baseline missing a changed SKU is also refused", async () => {
    await setup();
    await expect(
      applyInventoryImport(getDb(), { text: "SK-1,15", reason: "adjust", baseline: [] }, owner),
    ).rejects.toThrow(/Stock changed after the preview/);
    expect(await onHand("SK-1")).toBe(10);
  });

  it("applies nothing and writes no audit when every line already matches", async () => {
    await setup();
    const res = await previewThenApply("SK-1,10\nCT-1,3");
    expect(res).toEqual({ changed: 0, unchanged: 2, productIds: [] });
    expect(await audits()).toHaveLength(0);
  });

  it("validates the reason and size, and is for roles with inventory:import only", async () => {
    await setup();
    await expect(previewInventoryImport(getDb(), { text: "SK-1,1", reason: "sale" }, owner)).rejects.toBeInstanceOf(ZodError);
    await expect(previewInventoryImport(getDb(), { text: "x".repeat(600_001), reason: "adjust" }, owner)).rejects.toBeInstanceOf(ZodError);
    await expect(previewInventoryImport(getDb(), { text: "SK-1,1", reason: "adjust" }, staff)).rejects.toThrow(/Forbidden/);
    await expect(
      applyInventoryImport(getDb(), { text: "SK-1,1", reason: "adjust", baseline: [{ sku: "SK-1", onHand: 10 }] }, staff),
    ).rejects.toThrow(/Forbidden/);
    expect(await onHand("SK-1")).toBe(10);
    expect(await moves()).toHaveLength(0);
  });
});
