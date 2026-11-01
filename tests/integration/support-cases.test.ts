import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { adminAuditLog, notificationOutbox, orderEvents, orders, supportCases, user } from "@/server/db/schema";
import { addShipment, updateFulfilment } from "@/server/services/admin/orders";
import type { OrderAccess } from "@/server/services/customer-orders";
import { setSetting } from "@/server/services/settings";
import {
  SUPPORT_PHOTO_MAX,
  claimWindow,
  createSupportCase,
  prepareSupportPhotoUploads,
  reportableTypes,
  sniffPhotoType,
  type SupportPhotoStorage,
} from "@/server/services/support-cases";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { configureCommerce, placeCodOrder, seedCommerceReference } from "./helpers/factories";

const db = () => getDb();
const owner = { id: "owner-1", role: "owner" };
const ip = "203.0.113.5";

let f: Fixture;

/** In-memory photo storage: records what was handed out, "uploads" on demand. */
function fakeStorage(opts: { configured?: boolean } = {}) {
  const stored = new Map<string, { bytes: number; contentType: string; header?: Uint8Array }>();
  const storage: SupportPhotoStorage = {
    configured: () => opts.configured ?? true,
    createUpload: async (path) => ({ url: `https://storage.test/upload/${path}` }),
    inspect: async (path) => stored.get(path) ?? null,
  };
  return { storage, stored };
}

beforeEach(async () => {
  await db()
    .insert(user)
    .values([
      { id: "owner-1", name: "Owner", email: "owner@example.com", role: "owner" },
      { id: "cust-a", name: "Asha", email: "asha@example.com", emailVerified: true },
      { id: "cust-b", name: "Bela", email: "bela@example.com", emailVerified: true },
    ]);
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
});

/** A COD order for asha, shipped (so goods problems can be reported) unless `shipped: false`. */
async function order(opts: { shipped?: boolean; delivered?: boolean } = {}) {
  const placed = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }], { form: { email: "asha@example.com" } });
  await db().update(orders).set({ userId: "cust-a" }).where(eq(orders.id, placed.order.orderId));
  if (opts.shipped !== false) {
    await addShipment(db(), placed.order.orderId, { courier: "Delhivery" }, owner);
    if (opts.delivered) {
      await updateFulfilment(db(), placed.order.orderId, { to: "out_for_delivery" }, owner);
      await updateFulfilment(db(), placed.order.orderId, { to: "delivered" }, owner);
    }
  }
  return placed;
}
const token = (p: Awaited<ReturnType<typeof order>>): OrderAccess => ({ kind: "token", token: p.token });
const mine: OrderAccess = { kind: "account", userId: "cust-a", email: "asha@example.com" };
const outbox = async (template: string) => (await db().select().from(notificationOutbox)).filter((r) => r.template === template);

describe("createSupportCase", () => {
  it("creates the case, a visible timeline entry, the team alert and the customer acknowledgement", async () => {
    const placed = await order({ delivered: true });
    await setSetting("admin_alert_emails", ["team@example.com"], null);
    const res = await createSupportCase(db(), {
      ref: placed.order.ref,
      access: token(placed),
      raw: { type: "damaged", description: "The charm arrived with a crack across it." },
      ip,
    });
    expect(res).toMatchObject({ ok: true, late: false });
    if (!res.ok) return;

    const [row] = await db().select().from(supportCases).where(eq(supportCases.id, res.caseId));
    expect(row).toMatchObject({
      orderId: placed.order.orderId,
      type: "damaged",
      status: "open",
      description: "The charm arrived with a crack across it.",
      photoPaths: [],
      notes: null,
    });
    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, placed.order.orderId));
    expect(events.find((e) => e.type === "support_case_opened")).toMatchObject({ visibleToCustomer: true });

    const [alert] = await outbox("new_support_case");
    expect(alert).toMatchObject({ to: "team@example.com", status: "pending" });
    expect(alert!.payload).toMatchObject({ ref: placed.order.ref, caseId: res.caseId, type: "damaged" });
    const [ack] = await outbox("support_case_update");
    expect(ack).toMatchObject({ to: "asha@example.com" });
    expect(ack!.payload).toMatchObject({ ref: placed.order.ref, caseId: res.caseId, status: "open" });
    expect((await db().select().from(adminAuditLog).where(eq(adminAuditLog.action, "support_case.create"))).length).toBe(1);
  });

  it("works for the signed-in owner, with photos that are really in storage", async () => {
    const placed = await order({ delivered: true });
    const { storage, stored } = fakeStorage();
    const prep = await prepareSupportPhotoUploads(
      db(),
      { ref: placed.order.ref, access: mine, ip, files: [{ type: "image/jpeg", size: 1000 }, { type: "image/png", size: 2000 }] },
      { storage },
    );
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    expect(prep.uploads).toHaveLength(2);
    expect(prep.uploads[0]!.path).toMatch(new RegExp(`^support/${placed.order.orderId}/[0-9a-f-]{36}\\.jpg$`));

    // before the browser PUTs the files, the paths are not accepted
    const early = await createSupportCase(
      db(),
      { ref: placed.order.ref, access: mine, raw: { type: "defective", description: "It does not close properly.", photoPaths: prep.uploads.map((u) => u.path) }, ip },
      { storage },
    );
    expect(early).toMatchObject({ ok: false, code: "invalid" });

    stored.set(prep.uploads[0]!.path, { bytes: 1000, contentType: "image/jpeg" });
    stored.set(prep.uploads[1]!.path, { bytes: 2000, contentType: "image/png" });
    const res = await createSupportCase(
      db(),
      { ref: placed.order.ref, access: mine, raw: { type: "defective", description: "It does not close properly.", photoPaths: prep.uploads.map((u) => u.path) }, ip },
      { storage },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [row] = await db().select().from(supportCases).where(eq(supportCases.id, res.caseId));
    expect(row!.photoPaths).toEqual(prep.uploads.map((u) => u.path));
    const [audit] = await db().select().from(adminAuditLog).where(eq(adminAuditLog.action, "support_case.create"));
    expect(audit!.actorId).toBe("cust-a");
  });

  it("rejects photo paths that are not this order's, or whose stored file is the wrong type or size", async () => {
    const placed = await order({ delivered: true });
    const other = await order({ delivered: true });
    const { storage, stored } = fakeStorage();
    const foreign = `support/${other.order.orderId}/11111111-1111-4111-8111-111111111111.jpg`;
    stored.set(foreign, { bytes: 10, contentType: "image/jpeg" });
    const base = { ref: placed.order.ref, access: token(placed), ip };
    const description = "A description long enough.";

    for (const bad of [foreign, "../../etc/passwd", "support/x.jpg", `support/${placed.order.orderId}/../x.jpg`]) {
      const r = await createSupportCase(db(), { ...base, raw: { type: "damaged", description, photoPaths: [bad] } }, { storage });
      expect(r, bad).toMatchObject({ ok: false, code: "invalid" });
    }

    const wrongType = `support/${placed.order.orderId}/22222222-2222-4222-8222-222222222222.jpg`;
    stored.set(wrongType, { bytes: 10, contentType: "text/html" });
    const huge = `support/${placed.order.orderId}/33333333-3333-4333-8333-333333333333.jpg`;
    stored.set(huge, { bytes: 50 * 1024 * 1024, contentType: "image/jpeg" });
    for (const bad of [wrongType, huge]) {
      const r = await createSupportCase(db(), { ...base, raw: { type: "damaged", description, photoPaths: [bad] } }, { storage });
      expect(r).toMatchObject({ ok: false, code: "invalid" });
    }
    expect(await db().select().from(supportCases)).toHaveLength(0);
  });

  it("checks the file's own first bytes, not just the type the uploader claimed", async () => {
    const placed = await order({ delivered: true });
    const { storage, stored } = fakeStorage();
    const base = { ref: placed.order.ref, access: token(placed), ip };
    const description = "A description long enough.";
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const html = new TextEncoder().encode("<html><script>x</script>");

    const disguised = `support/${placed.order.orderId}/44444444-4444-4444-8444-444444444444.jpg`;
    stored.set(disguised, { bytes: 24, contentType: "image/jpeg", header: html });
    const wrongExt = `support/${placed.order.orderId}/55555555-5555-4555-8555-555555555555.png`;
    stored.set(wrongExt, { bytes: 24, contentType: "image/jpeg", header: jpeg });
    for (const bad of [disguised, wrongExt]) {
      const r = await createSupportCase(db(), { ...base, raw: { type: "damaged", description, photoPaths: [bad] } }, { storage });
      expect(r, bad).toMatchObject({ ok: false, code: "invalid" });
    }

    const genuine = `support/${placed.order.orderId}/66666666-6666-4666-8666-666666666666.jpg`;
    stored.set(genuine, { bytes: 24, contentType: "image/jpeg", header: jpeg });
    const ok = await createSupportCase(db(), { ...base, raw: { type: "damaged", description, photoPaths: [genuine] } }, { storage });
    expect(ok.ok).toBe(true);
  });

  it("recognises JPEG, PNG and WebP by their first bytes only", () => {
    const bytes = (...b: number[]) => Uint8Array.from([...b, ...Array(16 - b.length).fill(0)]);
    expect(sniffPhotoType(bytes(0xff, 0xd8, 0xff))).toBe("image/jpeg");
    expect(sniffPhotoType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffPhotoType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe("image/webp");
    expect(sniffPhotoType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45))).toBeNull(); // WAV
    expect(sniffPhotoType(new TextEncoder().encode("GIF89a"))).toBeNull();
  });

  it("validates type and description, and caps the number of photos", async () => {
    const placed = await order({ delivered: true });
    const base = { ref: placed.order.ref, access: token(placed), ip };
    const r1 = await createSupportCase(db(), { ...base, raw: { type: "nonsense", description: "short" } });
    expect(r1).toMatchObject({ ok: false, code: "invalid" });
    if (!r1.ok) expect(Object.keys(r1.fieldErrors ?? {}).sort()).toEqual(["description", "type"]);
    const r2 = await createSupportCase(db(), {
      ...base,
      raw: { type: "damaged", description: "Long enough text here.", photoPaths: Array.from({ length: SUPPORT_PHOTO_MAX + 1 }, (_, i) => `p${i}`) },
    });
    expect(r2).toMatchObject({ ok: false, code: "invalid", fieldErrors: { photoPaths: expect.any(String) } });
  });

  it("is not available to somebody else's order or a bad token", async () => {
    const placed = await order({ delivered: true });
    const raw = { type: "damaged", description: "The charm arrived with a crack." };
    for (const access of [
      { kind: "account", userId: "cust-b", email: "bela@example.com" } as OrderAccess,
      { kind: "token", token: "wrong-wrong-wrong" } as OrderAccess,
    ]) {
      expect(await createSupportCase(db(), { ref: placed.order.ref, access, raw, ip })).toMatchObject({
        ok: false,
        code: "not_found",
      });
    }
    expect(await db().select().from(supportCases)).toHaveLength(0);
  });

  it("offers goods problems only once the parcel is on its way; 'something else' any time", async () => {
    const fresh = await order({ shipped: false });
    const raw = { type: "damaged", description: "It will probably arrive broken." };
    const early = await createSupportCase(db(), { ref: fresh.order.ref, access: token(fresh), raw, ip });
    expect(early).toMatchObject({ ok: false, code: "not_reportable" });
    const other = await createSupportCase(db(), {
      ref: fresh.order.ref,
      access: token(fresh),
      raw: { type: "other", description: "Can I change the delivery address?" },
      ip,
    });
    expect(other.ok).toBe(true);

    expect(reportableTypes({ status: "confirmed", fulfillmentStatus: "unfulfilled" })).toEqual(["other"]);
    expect(reportableTypes({ status: "processing", fulfillmentStatus: "shipped" })).toHaveLength(5);
    expect(reportableTypes({ status: "cancelled", fulfillmentStatus: "unfulfilled" })).toEqual([]);
    expect(reportableTypes({ status: "pending_payment", fulfillmentStatus: "unfulfilled" })).toEqual([]);
  });

  it("past the claim window it still accepts the report and flags it for the team", async () => {
    await setSetting("damaged_claim_window_hours", 48, null);
    const placed = await order({ delivered: true });
    const raw = { type: "damaged", description: "Noticed the crack only now." };
    const now = new Date(Date.now() + 100 * 3_600_000);

    const late = await createSupportCase(db(), { ref: placed.order.ref, access: token(placed), raw, ip, now });
    expect(late).toMatchObject({ ok: true, late: true });
    if (!late.ok) return;
    const [row] = await db().select().from(supportCases).where(eq(supportCases.id, late.caseId));
    expect(row!.notes).toMatch(/after delivery; the claim window is 48 hours/);
    const [alert] = await outbox("new_support_case");
    expect((alert!.payload as { description: string }).description).toMatch(/^\[Late report\]/);

    // a "wrong item" report is never refused for being late either
    const wrong = await createSupportCase(db(), {
      ref: placed.order.ref,
      access: token(placed),
      raw: { type: "wrong", description: "This is not the colour I ordered." },
      ip,
      now,
    });
    expect(wrong).toMatchObject({ ok: true, late: true });

    // within the window: not flagged
    const inTime = await order({ delivered: true });
    const ok = await createSupportCase(db(), { ref: inTime.order.ref, access: token(inTime), raw, ip });
    expect(ok).toMatchObject({ ok: true, late: false });
  });

  it("does not flag anything while the window is the unset placeholder", async () => {
    const placed = await order({ delivered: true });
    const res = await createSupportCase(db(), {
      ref: placed.order.ref,
      access: token(placed),
      raw: { type: "damaged", description: "Cracked in the post." },
      ip,
      now: new Date(Date.now() + 1000 * 3_600_000),
    });
    expect(res).toMatchObject({ ok: true, late: false });
  });

  it("caps open reports per order", async () => {
    const placed = await order({ delivered: true });
    const raw = { type: "other", description: "Another question about this order." };
    for (let i = 0; i < 3; i++) {
      expect((await createSupportCase(db(), { ref: placed.order.ref, access: token(placed), raw, ip })).ok).toBe(true);
    }
    expect(await createSupportCase(db(), { ref: placed.order.ref, access: token(placed), raw, ip })).toMatchObject({
      ok: false,
      code: "too_many_open",
    });
  });
});

describe("prepareSupportPhotoUploads", () => {
  it("degrades gracefully when storage is not configured", async () => {
    const placed = await order({ delivered: true });
    const { storage } = fakeStorage({ configured: false });
    const res = await prepareSupportPhotoUploads(
      db(),
      { ref: placed.order.ref, access: token(placed), ip, files: [{ type: "image/jpeg", size: 100 }] },
      { storage },
    );
    expect(res).toMatchObject({ ok: false, code: "storage_unavailable" });
    // and a report without photos still works
    expect(
      (await createSupportCase(db(), { ref: placed.order.ref, access: token(placed), raw: { type: "damaged", description: "Cracked in the post." }, ip }, { storage })).ok,
    ).toBe(true);
  });

  it("validates type, size and count, and needs ownership", async () => {
    const placed = await order({ delivered: true });
    const { storage } = fakeStorage();
    const base = { ref: placed.order.ref, access: token(placed), ip };
    for (const files of [
      [{ type: "application/pdf", size: 100 }],
      [{ type: "image/jpeg", size: 0 }],
      [{ type: "image/jpeg", size: 9 * 1024 * 1024 }],
      Array.from({ length: SUPPORT_PHOTO_MAX + 1 }, () => ({ type: "image/jpeg", size: 10 })),
    ]) {
      expect(await prepareSupportPhotoUploads(db(), { ...base, files }, { storage })).toMatchObject({ ok: false, code: "invalid" });
    }
    expect(
      await prepareSupportPhotoUploads(
        db(),
        { ...base, access: { kind: "token", token: "nope-nope-nope" }, files: [{ type: "image/jpeg", size: 10 }] },
        { storage },
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(await prepareSupportPhotoUploads(db(), { ...base, files: [] }, { storage })).toEqual({ ok: true, uploads: [] });
  });
});

describe("claimWindow (pure)", () => {
  const delivered = new Date("2026-10-01T10:00:00Z");
  it("is late only when a window is set, the order was delivered and the window has passed", () => {
    expect(claimWindow(48, delivered, new Date("2026-10-02T10:00:00Z")).late).toBe(false);
    expect(claimWindow(48, delivered, new Date("2026-10-03T10:00:00Z")).late).toBe(false); // exactly 48h
    expect(claimWindow(48, delivered, new Date("2026-10-03T10:01:00Z")).late).toBe(true);
    expect(claimWindow(0, delivered, new Date("2027-10-03T10:01:00Z")).late).toBe(false);
    expect(claimWindow(48, null, new Date("2027-10-03T10:01:00Z")).late).toBe(false);
  });
});
