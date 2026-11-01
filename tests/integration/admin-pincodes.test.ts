import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { getDb } from "@/server/db";
import { adminAuditLog, pincodes, user } from "@/server/db/schema";
import {
  applyPincodeCsv,
  bulkUpdatePincodes,
  exportPincodes,
  getPincodeFacets,
  getPincodeSummary,
  listPincodes,
  parsePincodeCsv,
  previewBulkPincodes,
  previewPincodeCsv,
  setPincodeFlags,
  pincodesCsv,
} from "@/server/services/admin/pincodes";
import { AdminInputError } from "@/server/services/admin/products";
import { checkServiceability, lookupPincodeInfo } from "@/server/services/commerce/pincode";

import { seedCommerceReference } from "./helpers/factories";

const owner = { id: "owner-1", role: "owner" };
const admin = { id: "admin-1", role: "admin" };

/**
 * Seeded by seedCommerceReference: 400001 Mumbai, 411001 Pune (COD off), 560001 Bangalore,
 * 110001 Delhi, 744101 Andaman (not serviceable). States 27 (MH), 29 (KA), 07 (DL), 35 (AN).
 */
async function setup() {
  await getDb()
    .insert(user)
    .values([
      { id: "owner-1", name: "Owner", email: "owner@example.com", role: "owner" },
      { id: "admin-1", name: "Admin", email: "admin@example.com", role: "admin" },
    ]);
  await seedCommerceReference();
}

const flags = async (pincode: string) =>
  (await getDb().select().from(pincodes).where(eq(pincodes.pincode, pincode)))[0]!;
const audits = (action: string) =>
  getDb().select().from(adminAuditLog).where(eq(adminAuditLog.action, action));

describe("admin pincodes: reading", () => {
  it("lists, paginates and filters by pincode prefix, district, state, zone, serviceable and COD", async () => {
    await setup();
    const db = getDb();
    expect((await listPincodes(db)).total).toBe(5);
    expect((await listPincodes(db, { q: "4" })).items.map((r) => r.pincode)).toEqual(["400001", "411001"]);
    expect((await listPincodes(db, { q: "pun" })).items.map((r) => r.pincode)).toEqual(["411001"]);
    expect((await listPincodes(db, { q: "100%" })).total).toBe(0);
    expect((await listPincodes(db, { stateCode: "27" })).total).toBe(2);
    expect((await listPincodes(db, { zone: "islands" })).items[0]).toMatchObject({
      pincode: "744101",
      stateName: "Andaman and Nicobar Islands",
      serviceable: false,
    });
    expect((await listPincodes(db, { serviceable: false })).total).toBe(1);
    expect((await listPincodes(db, { cod: false })).items.map((r) => r.pincode)).toEqual(["411001"]);
    expect((await listPincodes(db, { stateCode: "27", cod: true })).items.map((r) => r.pincode)).toEqual(["400001"]);
    // Out-of-range pages clamp to the last page.
    const page = await listPincodes(db, {}, 99);
    expect(page).toMatchObject({ page: 1, pageCount: 1, total: 5 });
  });

  it("paginates large result sets by 50", async () => {
    await setup();
    const db = getDb();
    await db.insert(pincodes).values(
      Array.from({ length: 120 }, (_, i) => ({
        pincode: String(500000 + i),
        district: `D${i}`,
        stateCode: "29",
        zone: "rest_of_india",
      })),
    );
    const p2 = await listPincodes(db, { stateCode: "29" }, 2);
    expect(p2).toMatchObject({ total: 121, page: 2, pageCount: 3, pageSize: 50 });
    expect(p2.items).toHaveLength(50);
    expect(p2.items[0]!.pincode).toBe("500050");
  });

  it("summary and facets", async () => {
    await setup();
    expect(await getPincodeSummary(getDb())).toEqual({ total: 5, notServiceable: 1, codOff: 1 });
    const f = await getPincodeFacets(getDb());
    expect(f.states.map((s) => s.code).sort()).toEqual(["07", "27", "29", "35"]);
    expect(f.zones).toContain("north_east");
  });
});

describe("admin pincodes: one pincode", () => {
  it("toggles serviceable and COD, writes one audit row, and checkout sees it at once", async () => {
    await setup();
    const db = getDb();
    expect(checkServiceability("400001", await lookupPincodeInfo(db, "400001"))).toEqual({ serviceable: true });

    const res = await setPincodeFlags(db, { pincode: "400001", serviceable: false }, owner);
    expect(res).toEqual({ pincode: "400001", changed: true, serviceable: false, codAllowed: true });
    // No cache in between: the very next lookup refuses it.
    expect(checkServiceability("400001", await lookupPincodeInfo(db, "400001"))).toMatchObject({
      serviceable: false,
      code: "not_serviceable",
    });
    const [row] = await audits("pincode.update");
    expect(row).toMatchObject({ actorId: "owner-1", entity: "pincode", entityId: "400001" });
    expect(row!.diff).toEqual({ serviceable: { from: true, to: false } });

    // Turn it back on and COD off in one go; the diff lists only what changed.
    await setPincodeFlags(db, { pincode: "400001", serviceable: true, codAllowed: false }, owner);
    expect((await audits("pincode.update"))[1]!.diff).toEqual({
      serviceable: { from: false, to: true },
      codAllowed: { from: true, to: false },
    });
    expect(await flags("400001")).toMatchObject({ serviceable: true, codAllowed: false });
  });

  it("no change means no audit row; unknown pincodes and bad input are refused", async () => {
    await setup();
    const db = getDb();
    expect(await setPincodeFlags(db, { pincode: "400001", serviceable: true }, owner)).toMatchObject({ changed: false });
    expect(await audits("pincode.update")).toHaveLength(0);
    await expect(setPincodeFlags(db, { pincode: "999999", serviceable: false }, owner)).rejects.toBeInstanceOf(AdminInputError);
    await expect(setPincodeFlags(db, { pincode: "400001" }, owner)).rejects.toBeInstanceOf(ZodError);
    await expect(setPincodeFlags(db, { pincode: "40001", serviceable: false }, owner)).rejects.toBeInstanceOf(ZodError);
  });

  it("only roles with setting:update may change anything", async () => {
    await setup();
    const db = getDb();
    await expect(setPincodeFlags(db, { pincode: "400001", serviceable: false }, admin)).rejects.toThrow(/Forbidden/);
    await expect(previewBulkPincodes(db, { filter: {}, set: { serviceable: false } }, admin)).rejects.toThrow(/Forbidden/);
    await expect(bulkUpdatePincodes(db, { filter: {}, set: { serviceable: false } }, admin)).rejects.toThrow(/Forbidden/);
    await expect(previewPincodeCsv(db, "400001,no", admin)).rejects.toThrow(/Forbidden/);
    await expect(applyPincodeCsv(db, { text: "400001,no" }, admin)).rejects.toThrow(/Forbidden/);
    expect((await flags("400001")).serviceable).toBe(true);
    expect(await getDb().select().from(adminAuditLog)).toHaveLength(0);
  });
});

describe("admin pincodes: bulk on a filter", () => {
  it("previews the count, applies to the whole filter (not a page) and writes ONE audit row", async () => {
    await setup();
    const db = getDb();
    const preview = await previewBulkPincodes(db, { filter: { stateCode: "27" }, set: { serviceable: false } }, owner);
    expect(preview).toEqual({ matched: 2, willChange: 2 });

    const res = await bulkUpdatePincodes(
      db,
      { filter: { stateCode: "27" }, set: { serviceable: false }, expectedChanges: 2 },
      owner,
    );
    expect(res).toEqual({ matched: 2, willChange: 2, changed: 2 });
    expect((await flags("400001")).serviceable).toBe(false);
    expect((await flags("411001")).serviceable).toBe(false);
    expect((await flags("560001")).serviceable).toBe(true);

    const rows = await audits("pincode.bulk_update");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityId).toBeNull();
    expect(rows[0]!.diff).toEqual({
      filter: { stateCode: "27", stateName: "Maharashtra" },
      set: { serviceable: false },
      matched: 2,
      changed: 2,
    });
  });

  it("counts only pincodes that would actually change, and a no-op writes nothing", async () => {
    await setup();
    const db = getDb();
    // 744101 is already unserviceable.
    expect(await previewBulkPincodes(db, { filter: { zone: "islands" }, set: { serviceable: false } }, owner)).toEqual({
      matched: 1,
      willChange: 0,
    });
    expect(await bulkUpdatePincodes(db, { filter: { zone: "islands" }, set: { serviceable: false } }, owner)).toMatchObject({ changed: 0 });
    expect(await audits("pincode.bulk_update")).toHaveLength(0);
    // COD off for a zone; 411001 already has it off.
    expect(
      await bulkUpdatePincodes(db, { filter: { zone: "rest_of_india" }, set: { codAllowed: false } }, owner),
    ).toMatchObject({ matched: 3, willChange: 2, changed: 2 });
    expect(await getPincodeSummary(db)).toMatchObject({ codOff: 3 });
  });

  it("an empty filter is the whole directory, and serving only some areas works as documented", async () => {
    await setup();
    const db = getDb();
    await bulkUpdatePincodes(db, { filter: {}, set: { serviceable: false } }, owner);
    expect((await getPincodeSummary(db)).notServiceable).toBe(5);
    await bulkUpdatePincodes(db, { filter: { stateCode: "29" }, set: { serviceable: true } }, owner);
    expect(checkServiceability("560001", await lookupPincodeInfo(db, "560001"))).toEqual({ serviceable: true });
    expect(checkServiceability("400001", await lookupPincodeInfo(db, "400001"))).toMatchObject({ code: "not_serviceable" });
  });

  it("refuses to apply when the confirmed count is stale", async () => {
    await setup();
    const db = getDb();
    await expect(
      bulkUpdatePincodes(db, { filter: { stateCode: "27" }, set: { serviceable: false }, expectedChanges: 1 }, owner),
    ).rejects.toThrow(/Nothing was saved/);
    expect((await flags("400001")).serviceable).toBe(true);
    expect(await audits("pincode.bulk_update")).toHaveLength(0);
  });

  it("validates the input", async () => {
    await setup();
    const db = getDb();
    await expect(bulkUpdatePincodes(db, { filter: {}, set: {} }, owner)).rejects.toBeInstanceOf(ZodError);
    await expect(bulkUpdatePincodes(db, { filter: { zone: "mars" }, set: { codAllowed: true } }, owner)).rejects.toBeInstanceOf(ZodError);
    await expect(bulkUpdatePincodes(db, { filter: { stateCode: "x" }, set: { codAllowed: true } }, owner)).rejects.toBeInstanceOf(ZodError);
  });
});

describe("admin pincodes: CSV", () => {
  it("exports the filter in the import format and it round-trips", async () => {
    await setup();
    const db = getDb();
    const { rows, truncated } = await exportPincodes(db, { stateCode: "27" });
    expect(truncated).toBe(false);
    const csv = pincodesCsv(rows);
    expect(csv.split("\r\n")[0]).toBe("pincode,serviceable,cod_allowed,district,state,zone");
    expect(csv).toContain("411001,yes,no,Pune,Maharashtra,rest_of_india");
    const preview = await previewPincodeCsv(db, csv, owner);
    expect(preview.counts).toMatchObject({ lines: 2, changed: 0, unchanged: 2 });
    expect(preview.canApply).toBe(false);
  });

  it("previews changes (old to new), unknown pincodes and bad lines without writing", async () => {
    await setup();
    const db = getDb();
    const text = [
      "pincode,serviceable,cod_allowed",
      "400001,no,",
      "411001,,yes",
      "560001,yes,yes",
      "999999,no,no",
      "12345,yes,yes",
      "110001,perhaps,yes",
    ].join("\n");
    const p = await previewPincodeCsv(db, text, owner);
    expect(p.counts).toMatchObject({ lines: 6, changed: 2, unchanged: 1, serviceableOff: 1, codOn: 1 });
    expect(p.changes).toEqual([
      expect.objectContaining({ line: 2, pincode: "400001", district: "Mumbai", serviceable: { from: true, to: false }, codAllowed: { from: true, to: true } }),
      expect.objectContaining({ line: 3, pincode: "411001", serviceable: { from: true, to: true }, codAllowed: { from: false, to: true } }),
    ]);
    expect(p.issueCount).toBe(3);
    expect(p.issues.map((i) => i.line)).toEqual([5, 6, 7]);
    expect(p.issues[0]!.message).toMatch(/not in the directory/);
    expect(p.canApply).toBe(false);
    expect((await flags("400001")).serviceable).toBe(true);
    expect(await getDb().select().from(adminAuditLog)).toHaveLength(0);
  });

  it("applies a clean file in one transaction with ONE audit row", async () => {
    await setup();
    const db = getDb();
    const text = "pincode,serviceable,cod_allowed\n400001,no,\n411001,,yes\n560001,yes,yes\n";
    const res = await applyPincodeCsv(db, { text, fileName: "areas.csv", expectedChanges: 2 }, owner);
    expect(res).toEqual({ changed: 2, unchanged: 1 });
    expect(await flags("400001")).toMatchObject({ serviceable: false, codAllowed: true });
    expect(await flags("411001")).toMatchObject({ serviceable: true, codAllowed: true });
    const rows = await audits("pincode.csv_import");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.diff).toMatchObject({
      file: "areas.csv",
      lines: 3,
      changed: 2,
      unchanged: 1,
      serviceableOff: 1,
      codOn: 1,
      sample: ["400001", "411001"],
    });
  });

  it("refuses a file with any problem line, or a changed count, and writes nothing", async () => {
    await setup();
    const db = getDb();
    await expect(applyPincodeCsv(db, { text: "400001,no\n999999,no" }, owner)).rejects.toThrow(/1 problem line/);
    await expect(applyPincodeCsv(db, { text: "400001,no", expectedChanges: 5 }, owner)).rejects.toThrow(/preview the file again/);
    await expect(applyPincodeCsv(db, { text: "x".repeat(900_001) }, owner)).rejects.toBeInstanceOf(ZodError);
    expect((await flags("400001")).serviceable).toBe(true);
    expect(await audits("pincode.csv_import")).toHaveLength(0);
  });

  it("handles a large upload (the whole directory) in chunks", async () => {
    await setup();
    const db = getDb();
    const bulk = Array.from({ length: 12_000 }, (_, i) => ({
      pincode: String(600000 + i),
      district: "D",
      stateCode: "29",
      zone: "rest_of_india",
    }));
    for (let i = 0; i < bulk.length; i += 4000) await db.insert(pincodes).values(bulk.slice(i, i + 4000));
    const text = ["pincode,serviceable,cod_allowed", ...bulk.map((b, i) => `${b.pincode},${i % 2 ? "no" : "yes"},no`)].join("\n");
    const preview = await previewPincodeCsv(db, text, owner);
    expect(preview.counts).toMatchObject({ lines: 12_000, changed: 12_000, serviceableOff: 6_000, codOff: 12_000 });
    expect(preview.changes).toHaveLength(100);
    const res = await applyPincodeCsv(db, { text, expectedChanges: 12_000 }, owner);
    expect(res.changed).toBe(12_000);
    expect(await audits("pincode.csv_import")).toHaveLength(1);
    expect(await getPincodeSummary(db)).toMatchObject({ notServiceable: 6_001, codOff: 12_001 });
  });

  it("parsePincodeCsv rejects files over the line cap", () => {
    const text = Array.from({ length: 25_001 }, (_, i) => `${100000 + i},yes`).join("\n");
    expect(parsePincodeCsv(text).issues[0]!.message).toMatch(/Too many lines/);
  });
});
