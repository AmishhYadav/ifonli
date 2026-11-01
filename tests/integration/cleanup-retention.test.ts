import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { contactMessages, notificationOutbox, orders, session, supportCases, user, verification } from "@/server/db/schema";
import { cleanupHousekeeping } from "@/server/payments/cleanup";
import { SUPPORT_TEXT_REMOVED } from "@/server/services/dpdp";
import {
  CONTACT_MESSAGE_RETENTION_DAYS,
  ORPHAN_PHOTO_GRACE_MS,
  SUPPORT_CASE_RETENTION_DAYS,
  SUPPORT_TEXT_EXPIRED,
  type PhotoSweepStorage,
} from "@/server/services/retention";

import { seedCatalogFixture } from "./catalog-fixture";
import { configureCommerce, placeCodOrder, seedCommerceReference } from "./helpers/factories";

const db = () => getDb();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe("cleanup: personal-data retention", () => {
  it("deletes delivered e-mails after 90 days, and expired sessions and verification rows", async () => {
    await db().insert(notificationOutbox).values([
      { channel: "email", template: "order_confirmation", to: "a@example.com", status: "sent", sentAt: daysAgo(91) },
      { channel: "email", template: "order_confirmation", to: "b@example.com", status: "sent", sentAt: daysAgo(10) },
      // Not delivered: kept until it is (or is dealt with by hand), whatever its age.
      { channel: "email", template: "order_confirmation", to: "c@example.com", status: "failed" },
      { channel: "email", template: "order_confirmation", to: "d@example.com", status: "pending" },
    ]);
    await db().insert(user).values({ id: "u1", name: "U", email: "u@example.com" });
    await db().insert(session).values([
      { id: "s-old", userId: "u1", token: "t-old", expiresAt: daysAgo(1) },
      { id: "s-live", userId: "u1", token: "t-live", expiresAt: new Date(Date.now() + 86_400_000) },
    ]);
    await db().insert(verification).values([
      { id: "v-old", identifier: "sign-in-otp-u@example.com", value: "1:0", expiresAt: daysAgo(1) },
      { id: "v-live", identifier: "sign-in-otp-v@example.com", value: "1:0", expiresAt: new Date(Date.now() + 600_000) },
    ]);

    expect(await cleanupHousekeeping(db())).toMatchObject({
      sentNotificationsDeleted: 1,
      expiredSessionsDeleted: 1,
      expiredVerificationsDeleted: 1,
    });
    expect((await db().select().from(notificationOutbox)).map((n) => n.to).sort()).toEqual([
      "b@example.com",
      "c@example.com",
      "d@example.com",
    ]);
    expect((await db().select().from(session)).map((s) => s.id)).toEqual(["s-live"]);
    expect((await db().select().from(verification)).map((v) => v.id)).toEqual(["v-live"]);
  });
});

const photo = (orderId: string, n: number) => `support/${orderId}/00000000-0000-4000-8000-00000000000${n}.jpg`;

/** An order to hang support cases on. */
async function anOrder() {
  const f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
  return (await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }])).order;
}

/** In-memory Storage holding `objects` (path -> upload time) under the private bucket. */
function fakeSweepStorage(objects: Map<string, Date>, opts: { configured?: boolean; failRemove?: boolean } = {}) {
  const removed: string[] = [];
  const storage: PhotoSweepStorage = {
    configured: () => opts.configured ?? true,
    listFolders: async (offset, limit) =>
      [...new Set([...objects.keys()].map((p) => p.split("/")[1]!))].sort().slice(offset, offset + limit),
    listPhotos: async (orderId) =>
      [...objects].filter(([p]) => p.startsWith(`support/${orderId}/`)).map(([p, createdAt]) => ({ name: p.split("/")[2]!, createdAt })),
    remove: async (paths) => {
      if (opts.failRemove) throw new Error("storage down");
      for (const p of paths) {
        removed.push(p);
        objects.delete(p);
      }
    },
  };
  return { storage, removed };
}

describe("cleanup: contact messages", () => {
  it("deletes closed messages after the retention period and keeps everything else", async () => {
    const old = daysAgo(CONTACT_MESSAGE_RETENTION_DAYS + 1);
    const recent = daysAgo(CONTACT_MESSAGE_RETENTION_DAYS - 1);
    const base = { name: "N", email: "n@example.com", message: "hello" };
    await db().insert(contactMessages).values([
      { ...base, status: "closed", updatedAt: old },
      { ...base, status: "closed", updatedAt: recent },
      { ...base, status: "new", updatedAt: old },
      { ...base, status: "open", updatedAt: old },
    ]);
    expect(await cleanupHousekeeping(db())).toMatchObject({ contactMessagesDeleted: 1 });
    expect((await db().select().from(contactMessages)).map((m) => m.status).sort()).toEqual(["closed", "new", "open"]);
  });
});

describe("cleanup: support cases", () => {
  it("erases the description and photos of cases closed long ago, keeps the case, and leaves open or recent ones", async () => {
    const order = await anOrder();
    const old = daysAgo(SUPPORT_CASE_RETENTION_DAYS + 1);
    const recent = daysAgo(SUPPORT_CASE_RETENTION_DAYS - 1);
    const mk = (status: "open" | "in_progress" | "resolved" | "rejected", updatedAt: Date, n: number) => ({
      orderId: order.orderId,
      type: "damaged" as const,
      description: `my text ${n}`,
      photoPaths: [photo(order.orderId, n)],
      status,
      resolution: status === "resolved" ? ("refund" as const) : status === "rejected" ? ("rejected" as const) : null,
      notes: "team note",
      updatedAt,
    });
    await db().insert(supportCases).values([mk("resolved", old, 1), mk("rejected", old, 2), mk("resolved", recent, 3), mk("open", old, 4), mk("in_progress", old, 5)]);

    const removed: string[][] = [];
    const out = await cleanupHousekeeping(db(), new Date(), { removePhotos: async (p) => void removed.push(p) });
    expect(out.supportCasesErased).toBe(2);
    expect(removed.flat().sort()).toEqual([photo(order.orderId, 1), photo(order.orderId, 2)]);

    const rows = await db().select().from(supportCases);
    const byText = (d: string) => rows.filter((r) => r.description === d);
    expect(byText(SUPPORT_TEXT_EXPIRED)).toHaveLength(2);
    for (const r of byText(SUPPORT_TEXT_EXPIRED)) {
      expect(r).toMatchObject({ photoPaths: [], type: "damaged", orderId: order.orderId, notes: "team note" });
    }
    expect(rows.find((r) => r.status === "resolved" && r.resolution === "refund" && r.description === SUPPORT_TEXT_EXPIRED)).toBeTruthy();
    expect(byText("my text 3")[0]!.photoPaths).toEqual([photo(order.orderId, 3)]);
    expect(byText("my text 4")).toHaveLength(1);
    expect(byText("my text 5")).toHaveLength(1);
    // the order (invoice and contact details) is untouched
    expect(await db().select().from(orders).where(eq(orders.id, order.orderId))).toHaveLength(1);

    // a second run finds nothing more to do
    expect(await cleanupHousekeeping(db(), new Date(), { removePhotos: async (p) => void removed.push(p) })).toMatchObject({ supportCasesErased: 0 });
  });

  it("skips cases already erased on account deletion, and still clears photos left on one", async () => {
    const order = await anOrder();
    const old = daysAgo(SUPPORT_CASE_RETENTION_DAYS + 1);
    await db().insert(supportCases).values([
      { orderId: order.orderId, type: "other", description: SUPPORT_TEXT_REMOVED, status: "resolved", updatedAt: old },
      { orderId: order.orderId, type: "other", description: SUPPORT_TEXT_REMOVED, photoPaths: [photo(order.orderId, 1)], status: "resolved", updatedAt: old },
    ]);
    const removed: string[][] = [];
    expect(await cleanupHousekeeping(db(), new Date(), { removePhotos: async (p) => void removed.push(p) })).toMatchObject({ supportCasesErased: 1 });
    expect(removed).toEqual([[photo(order.orderId, 1)]]);
  });

  it("is bounded: a storage failure does not undo the erasure or fail the run", async () => {
    const order = await anOrder();
    await db().insert(supportCases).values({
      orderId: order.orderId, type: "other", description: "x", photoPaths: [photo(order.orderId, 1)], status: "rejected", resolution: "rejected",
      updatedAt: daysAgo(SUPPORT_CASE_RETENTION_DAYS + 5),
    });
    const out = await cleanupHousekeeping(db(), new Date(), {
      removePhotos: async () => {
        throw new Error("storage down");
      },
    });
    expect(out.supportCasesErased).toBe(1);
    expect((await db().select().from(supportCases))[0]).toMatchObject({ description: SUPPORT_TEXT_EXPIRED, photoPaths: [] });
  });
});

describe("cleanup: orphaned support photos", () => {
  it("deletes unreferenced photos older than the grace period and never an attached or fresh one", async () => {
    const order = await anOrder();
    const now = new Date();
    const old = new Date(now.getTime() - ORPHAN_PHOTO_GRACE_MS - 60_000);
    const fresh = new Date(now.getTime() - 3_600_000);
    await db().insert(supportCases).values({
      orderId: order.orderId, type: "damaged", description: "d", photoPaths: [photo(order.orderId, 1)], status: "open",
    });
    const otherOrder = "11111111-1111-4111-8111-111111111111";
    const objects = new Map<string, Date>([
      [photo(order.orderId, 1), old], // attached
      [photo(order.orderId, 2), old], // orphan
      [photo(order.orderId, 3), fresh], // upload in progress / case not submitted yet
      [photo(otherOrder, 4), old], // order without any case
      [`support/${order.orderId}/not-a-photo.txt`, old], // wrong shape: never touched
    ]);
    const { storage, removed } = fakeSweepStorage(objects);
    const out = await cleanupHousekeeping(db(), now, { photoStorage: storage });
    expect(out.orphanPhotosDeleted).toBe(2);
    expect(removed.sort()).toEqual([photo(order.orderId, 2), photo(otherOrder, 4)].sort());
    expect([...objects.keys()].sort()).toEqual([photo(order.orderId, 1), photo(order.orderId, 3), `support/${order.orderId}/not-a-photo.txt`].sort());

    // idempotent
    expect((await cleanupHousekeeping(db(), now, { photoStorage: storage })).orphanPhotosDeleted).toBe(0);
  });

  it("does nothing without storage, and a storage failure does not fail the cleanup", async () => {
    const old = new Date(Date.now() - 3 * ORPHAN_PHOTO_GRACE_MS);
    const objects = new Map([[photo("11111111-1111-4111-8111-111111111111", 1), old]]);
    expect((await cleanupHousekeeping(db(), new Date(), { photoStorage: fakeSweepStorage(objects, { configured: false }).storage })).orphanPhotosDeleted).toBe(0);
    const failing = fakeSweepStorage(objects, { failRemove: true }).storage;
    expect((await cleanupHousekeeping(db(), new Date(), { photoStorage: failing })).orphanPhotosDeleted).toBe(0);
    expect(objects.size).toBe(1);
  });
});
