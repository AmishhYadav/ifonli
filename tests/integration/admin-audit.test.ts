import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { adminAuditLog, user } from "@/server/db/schema";
import {
  AUDIT_PAGE_SIZE,
  auditCsv,
  exportAuditLog,
  getAuditFacets,
  listAuditLog,
} from "@/server/services/admin/audit";

const db = () => getDb();
const owner = { role: "owner" };

async function seed() {
  await db()
    .insert(user)
    .values([
      { id: "owner-1", name: "Olivia Owner", email: "olivia@example.com", role: "owner" },
      { id: "admin-1", name: "Adam Admin", email: "adam@example.com", role: "admin" },
    ]);
  const at = (iso: string) => new Date(iso);
  await db()
    .insert(adminAuditLog)
    .values([
      {
        actorId: "owner-1",
        action: "setting.update",
        entity: "setting",
        entityId: "legal_name",
        diff: { before: 1, after: 2 },
        createdAt: at("2026-10-01T10:00:00+05:30"),
      },
      {
        actorId: "admin-1",
        action: "product.update",
        entity: "product",
        entityId: "p-1",
        diff: { name: { from: "a", to: "b" } },
        createdAt: at("2026-10-02T09:00:00+05:30"),
      },
      {
        actorId: "admin-1",
        action: "product.create",
        entity: "product",
        entityId: "p-2",
        diff: null,
        ip: "203.0.113.9",
        createdAt: at("2026-10-02T23:59:00+05:30"),
      },
      {
        actorId: "owner-1",
        action: "policy.publish",
        entity: "policy",
        entityId: "terms",
        createdAt: at("2026-10-03T00:00:00+05:30"),
      },
      {
        actorId: null,
        action: "stock.adjust",
        entity: "variant",
        entityId: "v-1",
        createdAt: at("2026-10-04T12:00:00+05:30"),
      },
    ]);
}

const actions = async (filters: Parameters<typeof listAuditLog>[2] = {}) =>
  (await listAuditLog(db(), owner, filters)).items.map((r) => r.action);

describe("audit log: listing and filters", () => {
  it("lists newest first with the actor's name and email", async () => {
    await seed();
    const page = await listAuditLog(db(), owner);
    expect(page.total).toBe(5);
    expect(page.items.map((r) => r.action)).toEqual([
      "stock.adjust",
      "policy.publish",
      "product.create",
      "product.update",
      "setting.update",
    ]);
    expect(page.items[1]).toMatchObject({
      actorName: "Owner",
      actorEmail: null,
      entityId: "terms",
    });
    expect(page.items[0]).toMatchObject({ actorId: null, actorName: null });
  });

  it("filters by actor id and by name or email text", async () => {
    await seed();
    expect(await actions({ actorId: "admin-1" })).toEqual(["product.create", "product.update"]);
    expect(await actions({ actor: "olivia" })).toEqual(["policy.publish", "setting.update"]);
    expect(await actions({ actor: "ADAM@exam" })).toEqual(["product.create", "product.update"]);
    expect(await actions({ actor: "nobody" })).toEqual([]);
    // LIKE wildcards in the text are literal.
    expect(await actions({ actor: "%" })).toEqual([]);
  });

  it("filters by entity, entity id and action (exact or prefix)", async () => {
    await seed();
    expect(await actions({ entity: "product" })).toEqual(["product.create", "product.update"]);
    expect(await actions({ entity: "product", entityId: "p-2" })).toEqual(["product.create"]);
    expect(await actions({ action: "product.update" })).toEqual(["product.update"]);
    expect(await actions({ action: "product.*" })).toEqual(["product.create", "product.update"]);
    expect(await actions({ action: "pro_uct.*" })).toEqual([]);
    expect(await actions({ action: "product" })).toEqual([]);
  });

  it("filters by an inclusive IST date range", async () => {
    await seed();
    // 2 Oct 23:59 IST and 3 Oct 00:00 IST are on different IST days (both are 2 Oct in UTC).
    expect(await actions({ from: "2026-10-02", to: "2026-10-02" })).toEqual([
      "product.create",
      "product.update",
    ]);
    expect(await actions({ from: "2026-10-03", to: "2026-10-03" })).toEqual(["policy.publish"]);
    expect(await actions({ from: "2026-10-03" })).toEqual(["stock.adjust", "policy.publish"]);
    expect(await actions({ to: "2026-10-01" })).toEqual(["setting.update"]);
    // Bad dates are ignored rather than failing.
    expect((await actions({ from: "yesterday", to: "2026-13-45" })).length).toBe(5);
    expect(
      await actions({ from: "2026-10-02", to: "2026-10-03", actor: "adam", entity: "product" }),
    ).toEqual(["product.create", "product.update"]);
  });

  it("paginates and clamps the page", async () => {
    await seed();
    const rows = Array.from({ length: 120 }, (_, i) => ({
      actorId: "owner-1",
      action: "bulk.action",
      entity: "bulk",
      entityId: String(i),
      createdAt: new Date(Date.UTC(2026, 9, 10, 0, 0, i)),
    }));
    await db().insert(adminAuditLog).values(rows);
    const first = await listAuditLog(db(), owner, { action: "bulk.action" });
    expect(first).toMatchObject({ total: 120, page: 1, pageCount: 3, pageSize: AUDIT_PAGE_SIZE });
    expect(first.items).toHaveLength(50);
    expect(first.items[0]?.entityId).toBe("119");
    const third = await listAuditLog(db(), owner, { action: "bulk.action", page: 3 });
    expect(third.items).toHaveLength(20);
    expect(third.items[19]?.entityId).toBe("0");
    expect((await listAuditLog(db(), owner, { action: "bulk.action", page: 99 })).page).toBe(3);
    expect((await listAuditLog(db(), owner, { action: "bulk.action", page: -4 })).page).toBe(1);
    expect(
      (await listAuditLog(db(), owner, { action: "bulk.action", pageSize: 10 })).pageCount,
    ).toBe(12);
  });

  it("facets list distinct entities, actions and actors for the dropdowns", async () => {
    await seed();
    const facets = await getAuditFacets(db(), owner);
    expect(facets.entities).toEqual(["policy", "product", "setting", "variant"]);
    expect(facets.actions).toEqual([
      "policy.publish",
      "product.create",
      "product.update",
      "setting.update",
      "stock.adjust",
    ]);
    expect(facets.actors).toEqual([
      { id: "admin-1", label: "Adam Admin (adam@example.com)" },
      { id: "owner-1", label: "Owner" },
    ]);
  });

  it("needs audit:view (fulfilment is refused; admin and owner may read)", async () => {
    await seed();
    await expect(listAuditLog(db(), { role: "fulfilment" })).rejects.toThrow(/Forbidden/);
    await expect(getAuditFacets(db(), { role: "customer" })).rejects.toThrow(/Forbidden/);
    await expect(exportAuditLog(db(), { role: "fulfilment" })).rejects.toThrow(/Forbidden/);
    await expect(listAuditLog(db(), { role: "admin" })).resolves.toBeTruthy();
  });
});

describe("audit log: CSV export", () => {
  it("exports the filtered rows with quoted JSON and neutralised formulas", async () => {
    await seed();
    await db()
      .insert(adminAuditLog)
      .values({
        actorId: "owner-1",
        action: "setting.update",
        entity: "setting",
        entityId: '=HYPERLINK("http://evil")',
        diff: { note: 'line1\nline2, "quoted"' },
        createdAt: new Date("2026-10-05T00:00:00Z"),
      });
    const { rows, truncated } = await exportAuditLog(db(), owner, { entity: "setting" });
    expect(truncated).toBe(false);
    const csv = auditCsv(rows);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Time (UTC),Actor,Actor email,Action,Entity,Entity id,IP,Changes");
    expect(csv).toContain(
      "2026-10-05T00:00:00.000Z,Owner,,setting.update,setting,",
    );
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`); // apostrophe-prefixed, quotes doubled
    expect(csv).toContain(`"{""note"":""line1\\nline2, \\""quoted\\""""}"`);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("labels system and deleted actors", async () => {
    await seed();
    const { rows } = await exportAuditLog(db(), owner, { entity: "variant" });
    expect(auditCsv(rows)).toContain(",system,,stock.adjust,variant,v-1,");
  });
});
