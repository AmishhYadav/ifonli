import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { getDb } from "@/server/db";
import {
  adminAuditLog,
  contactMessages,
  inventoryMovements,
  notificationOutbox,
  orderEvents,
  orderItems,
  orders,
  refunds,
  supportCases,
  user,
  variants,
} from "@/server/db/schema";
import { MockPaymentProvider } from "@/server/payments/mock";
import { setPaymentProvider } from "@/server/payments/registry";
import { getDashboardStats } from "@/server/services/admin/dashboard";
import { addShipment, markCodCollected, updateFulfilment } from "@/server/services/admin/orders";
import { AdminInputError } from "@/server/services/admin/products";
import {
  addContactMessageNote,
  addSupportCaseNote,
  assignContactMessage,
  assignSupportCase,
  caseShortId,
  getContactMessageDetail,
  getSupportCaseDetail,
  getSupportCounts,
  listAssignableStaff,
  listContactMessages,
  listSupportCases,
  rejectSupportCase,
  replyToContactMessage,
  resolveSupportCase,
  respondToSupportCase,
  setContactMessageStatus,
  setSupportCaseStatus,
  signCasePhotos,
} from "@/server/services/admin/support";
import { replacementKey } from "@/server/services/replacement-orders";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import {
  configureCommerce,
  placeCodOrder,
  placePaidOrder,
  seedCommerceReference,
} from "./helpers/factories";

const db = () => getDb();
const owner = { id: "owner-1", role: "owner" };
const admin = { id: "admin-1", role: "admin" };
const fulfilment = { id: "ful-1", role: "fulfilment" };

let f: Fixture;
let provider: MockPaymentProvider;

beforeEach(async () => {
  provider = new MockPaymentProvider({ deterministic: true });
  setPaymentProvider(provider);
  await db()
    .insert(user)
    .values([
      { id: "owner-1", name: "Owner One", email: "owner@example.com", role: "owner" },
      { id: "admin-1", name: "Admin One", email: "admin@example.com", role: "admin" },
      { id: "ful-1", name: "Packer One", email: "ful@example.com", role: "fulfilment" },
      { id: "cust-1", name: "Shopper", email: "shopper@example.com", role: "customer" },
      { id: "ban-1", name: "Banned Staff", email: "ban@example.com", role: "admin", banned: true },
    ]);
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
});
afterEach(() => {
  setPaymentProvider(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const outbox = async (template?: string) => {
  const rows = await db().select().from(notificationOutbox);
  return template ? rows.filter((r) => r.template === template) : rows;
};
const audit = async (action: string) => db().select().from(adminAuditLog).where(eq(adminAuditLog.action, action));
const orderRow = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!;
const caseRow = async (id: string) => (await db().select().from(supportCases).where(eq(supportCases.id, id)))[0]!;
const messageRow = async (id: string) => (await db().select().from(contactMessages).where(eq(contactMessages.id, id)))[0]!;
const stockOf = async (id: string) =>
  (await db().select({ n: variants.stockOnHand }).from(variants).where(eq(variants.id, id)))[0]!.n;

/** 2 x skull + shipping 50.00 = 44 800 paise, paid online. */
const paid = () => placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }]);

async function makeCase(
  orderId: string,
  overrides: Partial<typeof supportCases.$inferInsert> = {},
): Promise<string> {
  const [row] = await db()
    .insert(supportCases)
    .values({ orderId, type: "damaged", description: "The handle arrived cracked.", ...overrides })
    .returning({ id: supportCases.id });
  return row!.id;
}

async function makeMessage(overrides: Partial<typeof contactMessages.$inferInsert> = {}): Promise<string> {
  const [row] = await db()
    .insert(contactMessages)
    .values({
      name: "Asha Rao",
      email: "asha@example.com",
      message: "Can I change the delivery address of my order?",
      ...overrides,
    })
    .returning({ id: contactMessages.id });
  return row!.id;
}

/* ------------------------------------------------------------------------------------------ */

describe("support: lists, filters and counts", () => {
  it("filters the inbox by status, assignee and search, newest first, with pagination", async () => {
    const a = await makeMessage({ name: "Asha Rao", email: "asha@example.com", orderRef: "IFO-2611-AAAA", createdAt: new Date("2026-11-01T10:00:00Z") });
    const b = await makeMessage({ name: "Ben Kumar", email: "ben@example.org", status: "open", assignedTo: "ful-1", createdAt: new Date("2026-11-02T10:00:00Z") });
    const c = await makeMessage({ name: "Chitra", email: "chitra@example.com", status: "closed", createdAt: new Date("2026-11-03T10:00:00Z") });

    const all = await listContactMessages(db(), {});
    expect(all.items.map((m) => m.id)).toEqual([c, b, a]);
    expect(all.total).toBe(3);

    expect((await listContactMessages(db(), { status: "active" })).items.map((m) => m.id)).toEqual([b, a]);
    expect((await listContactMessages(db(), { status: "closed" })).items.map((m) => m.id)).toEqual([c]);
    expect((await listContactMessages(db(), { status: "new" })).items.map((m) => m.id)).toEqual([a]);
    expect((await listContactMessages(db(), { assignedTo: "ful-1" })).items.map((m) => [m.id, m.assigneeName])).toEqual([[b, "Packer One"]]);
    expect((await listContactMessages(db(), { assignedTo: "unassigned" })).items.map((m) => m.id)).toEqual([c, a]);
    expect((await listContactMessages(db(), { q: "ben@" })).items.map((m) => m.id)).toEqual([b]);
    expect((await listContactMessages(db(), { q: "asha" })).items.map((m) => m.id)).toEqual([a]);
    expect((await listContactMessages(db(), { q: "ifo-2611-aaaa" })).items.map((m) => m.id)).toEqual([a]);
    // LIKE wildcards in the search are literal
    expect((await listContactMessages(db(), { q: "%" })).items).toHaveLength(0);

    const p1 = await listContactMessages(db(), { pageSize: 2, page: 1 });
    const p2 = await listContactMessages(db(), { pageSize: 2, page: 2 });
    expect([p1.items.length, p2.items.length, p1.pageCount]).toEqual([2, 1, 2]);
    // an out-of-range page clamps to the last one
    expect((await listContactMessages(db(), { pageSize: 2, page: 99 })).page).toBe(2);
  });

  it("filters cases by status, type, assignee and search (order ref, e-mail, customer name, case id)", async () => {
    const o1 = await paid();
    const o2 = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }], { form: { email: "other@example.com", shippingAddress: { name: "Zed Zephyr", line1: "1 Road", city: "Mumbai", state: "Maharashtra", pincode: "400001" } } });
    const c1 = await makeCase(o1.order.orderId, { type: "damaged", photoPaths: ["cases/x/1.jpg", "cases/x/2.jpg"] });
    const c2 = await makeCase(o2.order.orderId, { type: "missing", status: "in_progress", assignedTo: "admin-1" });
    const c3 = await makeCase(o2.order.orderId, { type: "wrong", status: "resolved", resolution: "replacement" });

    const ids = async (f: Parameters<typeof listSupportCases>[1]) => (await listSupportCases(db(), f)).items.map((c) => c.id).sort();
    expect(await ids({})).toEqual([c1, c2, c3].sort());
    expect(await ids({ status: "active" })).toEqual([c1, c2].sort());
    expect(await ids({ status: "open" })).toEqual([c1]);
    expect(await ids({ status: "in_progress" })).toEqual([c2]);
    expect(await ids({ status: "resolved" })).toEqual([c3]);
    expect(await ids({ type: "missing" })).toEqual([c2]);
    expect(await ids({ assignedTo: "admin-1" })).toEqual([c2]);
    expect(await ids({ assignedTo: "unassigned" })).toEqual([c1, c3].sort());
    expect(await ids({ q: o1.order.ref.toLowerCase() })).toEqual([c1]);
    expect(await ids({ q: "other@example" })).toEqual([c2, c3].sort());
    expect(await ids({ q: "zephyr" })).toEqual([c2, c3].sort());
    expect(await ids({ q: c1.slice(0, 8) })).toEqual([c1]);
    expect(await ids({ status: "active", type: "damaged", q: "buyer@" })).toEqual([c1]);

    const row = (await listSupportCases(db(), { q: o1.order.ref })).items[0]!;
    expect(row).toMatchObject({
      orderRef: o1.order.ref,
      customerName: "Asha Rao",
      photoCount: 2,
      shortId: caseShortId(c1),
      assigneeName: null,
    });
    expect((await listSupportCases(db(), { pageSize: 2 })).pageCount).toBe(2);
  });

  it("counts what still needs the team, for the tab badges", async () => {
    const o = await paid();
    await makeMessage();
    await makeMessage({ status: "open", assignedTo: "ful-1" });
    await makeMessage({ status: "closed" });
    await makeCase(o.order.orderId);
    await makeCase(o.order.orderId, { status: "in_progress", assignedTo: "ful-1" });
    await makeCase(o.order.orderId, { status: "rejected", resolution: "rejected" });

    expect(await getSupportCounts(db())).toEqual({
      inbox: { new: 1, open: 1, active: 2, unassigned: 1 },
      cases: { open: 1, inProgress: 1, active: 2, unassigned: 1 },
    });
  });

  it("lists assignable staff: owner, admin and fulfilment, not customers or banned accounts", async () => {
    const staff = await listAssignableStaff(db());
    expect(staff.map((s) => s.id).sort()).toEqual(["admin-1", "ful-1", "owner-1"]);
  });
});

/* ------------------------------------------------------------------------------------------ */

describe("support: contact messages", () => {
  it("walks new -> open -> closed -> open and rejects the invalid moves", async () => {
    const id = await makeMessage();
    await expect(setContactMessageStatus(db(), id, { status: "new" }, owner)).rejects.toBeInstanceOf(AdminInputError);
    await expect(setContactMessageStatus(db(), id, { status: "bogus" }, owner)).rejects.toBeInstanceOf(ZodError);

    await setContactMessageStatus(db(), id, { status: "open" }, fulfilment);
    expect((await messageRow(id)).status).toBe("open");
    await expect(setContactMessageStatus(db(), id, { status: "open" }, owner)).rejects.toThrow(/already open/);
    await expect(setContactMessageStatus(db(), id, { status: "new" }, owner)).rejects.toThrow(/can't move/);

    await setContactMessageStatus(db(), id, { status: "closed" }, owner);
    await setContactMessageStatus(db(), id, { status: "open" }, owner);
    await setContactMessageStatus(db(), id, { status: "closed" }, owner);
    expect((await messageRow(id)).status).toBe("closed");

    const rows = await audit("contact_message.status");
    expect(rows.map((r) => (r.diff as { to: string }).to)).toEqual(expect.arrayContaining(["open", "closed"]));
    expect(rows[0]).toMatchObject({ entity: "contact_message", entityId: id, actorId: "ful-1" });
  });

  it("assigns to staff only, and unassigns", async () => {
    const id = await makeMessage();
    await assignContactMessage(db(), id, { assignedTo: "ful-1" }, admin);
    expect((await messageRow(id)).assignedTo).toBe("ful-1");
    await expect(assignContactMessage(db(), id, { assignedTo: "ful-1" }, admin)).rejects.toThrow(/Already assigned/);
    await expect(assignContactMessage(db(), id, { assignedTo: "cust-1" }, admin)).rejects.toThrow(/can't be assigned/);
    await expect(assignContactMessage(db(), id, { assignedTo: "ban-1" }, admin)).rejects.toThrow(/can't be assigned/);
    await expect(assignContactMessage(db(), id, { assignedTo: "nobody-here" }, admin)).rejects.toThrow(/can't be assigned/);
    await assignContactMessage(db(), id, { assignedTo: null }, fulfilment);
    expect((await messageRow(id)).assignedTo).toBeNull();
    const a = await audit("contact_message.assign");
    expect(a).toHaveLength(2);
    expect(a[0]!.diff).toMatchObject({ from: null, to: "Packer One" });
  });

  it("replies by e-mail through the outbox: new -> open, claims an unowned message, closed ones need a re-open", async () => {
    const id = await makeMessage({ email: "asha@example.com", name: "Asha Rao" });
    const r = await replyToContactMessage(db(), id, { message: "Yes, we have updated the address." }, fulfilment);
    expect(r.to).toBe("asha@example.com");

    expect(await messageRow(id)).toMatchObject({ status: "open", assignedTo: "ful-1" });
    const [mail] = await outbox("contact_reply");
    expect(mail).toMatchObject({ to: "asha@example.com", status: "pending", channel: "email" });
    expect(mail!.payload).toMatchObject({
      name: "Asha Rao",
      message: "Yes, we have updated the address.",
      original: "Can I change the delivery address of my order?",
      messageId: id,
    });
    expect((await audit("contact_message.reply"))[0]!.diff).toMatchObject({ message: "Yes, we have updated the address.", statusFrom: "new", statusTo: "open" });

    // a second reply by someone else keeps the owner
    await replyToContactMessage(db(), id, { message: "Anything else?" }, owner);
    expect((await messageRow(id)).assignedTo).toBe("ful-1");
    expect(await outbox("contact_reply")).toHaveLength(2);

    await setContactMessageStatus(db(), id, { status: "closed" }, owner);
    await expect(replyToContactMessage(db(), id, { message: "late" }, owner)).rejects.toThrow(/closed/);
    await expect(replyToContactMessage(db(), await makeMessage(), { message: "   " }, owner)).rejects.toBeInstanceOf(ZodError);
    expect(await outbox("contact_reply")).toHaveLength(2);
  });

  it("a reply is sent even when the owner switched the support e-mails off", async () => {
    const { setSetting } = await import("@/server/services/settings");
    await (setSetting as (k: string, v: unknown, a: string | null) => Promise<unknown>)(
      "notification_channels",
      Object.fromEntries(
        ["order_confirmed", "cod_order_placed", "payment_failed", "shipped", "delivered", "cancelled", "refund_initiated", "refund_processed", "support_case_update", "contact_ack"].map((k) => [k, { email: false, whatsapp: false }]),
      ),
      null,
    );
    const id = await makeMessage();
    await replyToContactMessage(db(), id, { message: "Hello" }, owner);
    expect(await outbox("contact_reply")).toHaveLength(1);
  });

  it("adds internal notes (audited, no e-mail) and shows them in the timeline", async () => {
    const id = await makeMessage();
    await addContactMessageNote(db(), id, { note: "Called the customer, will follow up." }, fulfilment);
    await expect(addContactMessageNote(db(), id, { note: " " }, fulfilment)).rejects.toBeInstanceOf(ZodError);
    expect(await outbox()).toHaveLength(0);
    const detail = await getContactMessageDetail(db(), id);
    expect(detail!.timeline).toHaveLength(1);
    expect(detail!.timeline[0]).toMatchObject({ action: "contact_message.note", actorName: "Packer One", detail: { note: "Called the customer, will follow up." } });
  });

  it("links the order when the reference matches and says whether the e-mail matches", async () => {
    const o = await paid(); // buyer@example.com
    const same = await makeMessage({ email: "Buyer@Example.com", orderRef: o.order.ref.toLowerCase() });
    const other = await makeMessage({ email: "stranger@example.com", orderRef: o.order.ref });
    const none = await makeMessage({ orderRef: "IFO-2611-ZZZZ" });
    const bare = await makeMessage();

    const d1 = await getContactMessageDetail(db(), same);
    expect(d1!.order).toMatchObject({ id: o.order.orderId, ref: o.order.ref, emailMatches: true, totalPaise: 44800 });
    expect((await getContactMessageDetail(db(), other))!.order).toMatchObject({ ref: o.order.ref, emailMatches: false });
    expect((await getContactMessageDetail(db(), none))!.order).toBeNull();
    expect((await getContactMessageDetail(db(), bare))!.order).toBeNull();
    expect(d1!.allowedStatuses).toEqual(["open", "closed"]);
    expect(await getContactMessageDetail(db(), "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("counts other messages from the same address", async () => {
    const a = await makeMessage({ email: "same@example.com" });
    await makeMessage({ email: "SAME@example.com" });
    await makeMessage({ email: "else@example.com" });
    expect((await getContactMessageDetail(db(), a))!.otherMessages).toBe(1);
  });
});

/* ------------------------------------------------------------------------------------------ */

describe("support: case status, assignment, responses", () => {
  it("open -> in_progress; everything else is rejected with a clear message", async () => {
    const o = await paid();
    const id = await makeCase(o.order.orderId);

    await expect(setSupportCaseStatus(db(), id, { status: "open" }, owner)).rejects.toThrow(/already open/);
    await expect(setSupportCaseStatus(db(), id, { status: "resolved" }, owner)).rejects.toThrow(/Use Resolve or Reject/);
    await expect(setSupportCaseStatus(db(), id, { status: "rejected" }, owner)).rejects.toThrow(/Use Resolve or Reject/);
    await expect(setSupportCaseStatus(db(), id, { status: "nonsense" }, owner)).rejects.toBeInstanceOf(ZodError);

    await setSupportCaseStatus(db(), id, { status: "in_progress" }, fulfilment);
    expect((await caseRow(id)).status).toBe("in_progress");
    await expect(setSupportCaseStatus(db(), id, { status: "open" }, owner)).rejects.toThrow(/can't move/);
    await expect(setSupportCaseStatus(db(), id, { status: "in_progress" }, owner)).rejects.toThrow(/already in progress/);

    // a terminal case cannot be moved at all
    await rejectSupportCase(db(), id, { message: "Sorry, not covered." }, owner);
    await expect(setSupportCaseStatus(db(), id, { status: "in_progress" }, owner)).rejects.toThrow(/can't move/);
    await expect(setSupportCaseStatus(db(), "00000000-0000-4000-8000-000000000000", { status: "in_progress" }, owner)).rejects.toThrow(/no longer exists/);
    expect((await audit("support_case.status")).map((r) => r.diff)).toEqual([{ from: "open", to: "in_progress" }]);
  });

  it("assigns and unassigns, staff only", async () => {
    const o = await paid();
    const id = await makeCase(o.order.orderId);
    await assignSupportCase(db(), id, { assignedTo: "admin-1" }, fulfilment);
    expect((await caseRow(id)).assignedTo).toBe("admin-1");
    await expect(assignSupportCase(db(), id, { assignedTo: "cust-1" }, owner)).rejects.toThrow(/can't be assigned/);
    await assignSupportCase(db(), id, { assignedTo: "ful-1" }, owner);
    await assignSupportCase(db(), id, { assignedTo: null }, owner);
    expect((await caseRow(id)).assignedTo).toBeNull();
    const a = await audit("support_case.assign");
    expect(a.map((r) => (r.diff as { to: string | null }).to)).toEqual(["Admin One", "Packer One", null]);
  });

  it("responds to the customer: queues support_case_update, open -> in_progress, claims the case", async () => {
    const o = await paid();
    const id = await makeCase(o.order.orderId);
    const r = await respondToSupportCase(db(), id, { message: "Sorry about that. Could you send a clearer photo?" }, fulfilment);
    expect(r.to).toBe("buyer@example.com");

    expect(await caseRow(id)).toMatchObject({ status: "in_progress", assignedTo: "ful-1" });
    const [mail] = await outbox("support_case_update");
    expect(mail).toMatchObject({ to: "buyer@example.com", orderId: o.order.orderId, status: "pending" });
    expect(mail!.payload).toMatchObject({
      ref: o.order.ref,
      caseId: id,
      status: "in_progress",
      note: "Sorry about that. Could you send a clearer photo?",
    });
    expect((await audit("support_case.respond"))[0]!.diff).toMatchObject({ message: "Sorry about that. Could you send a clearer photo?" });
    // the order timeline records that the team replied (internal)
    const ev = await db().select().from(orderEvents).where(and(eq(orderEvents.orderId, o.order.orderId), eq(orderEvents.type, "support_case_response")));
    expect(ev).toHaveLength(1);
    expect(ev[0]!.visibleToCustomer).toBe(false);

    await expect(respondToSupportCase(db(), id, { message: "" }, owner)).rejects.toBeInstanceOf(ZodError);
    // responding again does not steal the case
    await respondToSupportCase(db(), id, { message: "Any news?" }, owner);
    expect((await caseRow(id)).assignedTo).toBe("ful-1");
  });

  it("a response is allowed after the case is closed, without reopening or claiming it", async () => {
    const o = await paid();
    const id = await makeCase(o.order.orderId);
    await rejectSupportCase(db(), id, { message: "Not covered." }, owner);
    const before = await caseRow(id);
    await respondToSupportCase(db(), id, { message: "Following up." }, fulfilment);
    const after = await caseRow(id);
    expect(after).toMatchObject({ status: "rejected", assignedTo: before.assignedTo });
    const mails = await outbox("support_case_update");
    expect(mails[mails.length - 1]!.payload).toMatchObject({ status: "rejected", resolution: "rejected", note: "Following up." });
  });

  it("notes are audited, internal, and appear in the case timeline with the other events", async () => {
    const o = await paid();
    const id = await makeCase(o.order.orderId);
    await addSupportCaseNote(db(), id, { note: "Photo shows a clean break." }, fulfilment);
    await respondToSupportCase(db(), id, { message: "Hello" }, fulfilment);
    expect(await outbox("support_case_update")).toHaveLength(1); // the note sent nothing
    const detail = await getSupportCaseDetail(db(), id);
    expect(detail!.timeline.map((t) => t.action)).toEqual(["support_case.note", "support_case.respond"]);
    expect(detail!.timeline[0]).toMatchObject({ actorName: "Packer One" });
  });
});

/* ------------------------------------------------------------------------------------------ */

describe("support: resolve with a refund", () => {
  it("partial refund through refundOrder: refund row, case resolved, refund linked in notes, customer e-mailed", async () => {
    const o = await paid();
    const id = await makeCase(o.order.orderId);

    const res = await resolveSupportCase(
      db(),
      id,
      { resolution: "refund", amountPaise: 10_000, note: "Cracked handle, goodwill part refund." },
      admin,
      provider,
    );
    expect(res.refund).toMatchObject({ amountPaise: 10_000, providerError: null });
    expect(res.replacement).toBeNull();

    const [refund] = await db().select().from(refunds).where(eq(refunds.orderId, o.order.orderId));
    expect(refund).toMatchObject({ amountPaise: 10_000, actorId: "admin-1" });
    expect(refund!.reason).toContain(`Support case ${caseShortId(id)}`);
    expect(refund!.id).toBe(res.refund!.refundId);

    const c = await caseRow(id);
    expect(c).toMatchObject({ status: "resolved", resolution: "refund", assignedTo: "admin-1" });
    expect(c.notes).toContain("Refunded ₹100");
    expect(c.notes).toContain(`refund ${refund!.id.slice(0, 8)}`);
    expect(c.notes).toContain("Cracked handle, goodwill part refund.");

    const mails = (await outbox("support_case_update")).filter((m) => (m.payload as { status: string }).status === "resolved");
    expect(mails).toHaveLength(1);
    expect(mails[0]!.payload).toMatchObject({ resolution: "refund", caseId: id });
    expect((mails[0]!.payload as { note: string }).note).toContain("₹100");

    const a = await audit("support_case.resolve");
    expect(a).toHaveLength(1);
    expect(a[0]!.diff).toMatchObject({ resolution: "refund", refundId: refund!.id, amountPaise: 10_000 });
    // the order shows a partial refund, the case shows on the order timeline
    expect((await orderRow(o.order.orderId)).paymentStatus).toMatch(/paid|partially_refunded/);
    const types = (await db().select().from(orderEvents).where(eq(orderEvents.orderId, o.order.orderId))).map((e) => e.type);
    expect(types).toContain("support_case_resolved");
    expect(types).toContain("refund_initiated");

    // a closed case cannot be resolved again, and no second refund is made
    await expect(
      resolveSupportCase(db(), id, { resolution: "refund", amountPaise: 100 }, admin, provider),
    ).rejects.toThrow(/already resolved/);
    expect(await db().select().from(refunds)).toHaveLength(1);
  });

  it("full refund of what is left; a refund above the refundable amount is refused and the case stays open", async () => {
    const o = await paid();
    const id = await makeCase(o.order.orderId);
    await expect(
      resolveSupportCase(db(), id, { resolution: "refund", amountPaise: 44_801 }, owner, provider),
    ).rejects.toThrow(/At most/);
    expect(await caseRow(id)).toMatchObject({ status: "open", resolution: null });
    expect(await db().select().from(refunds)).toHaveLength(0);
    expect(await outbox("support_case_update")).toHaveLength(0);

    await resolveSupportCase(db(), id, { resolution: "refund", amountPaise: 44_800, message: "Full refund on its way." }, owner, provider);
    expect((await orderRow(o.order.orderId)).paymentStatus).toBe("refunded");
    const [mail] = (await outbox("support_case_update")).filter((m) => (m.payload as { status: string }).status === "resolved");
    expect((mail!.payload as { note: string }).note).toBe("Full refund on its way.");
    await expect(resolveSupportCase(db(), id, { resolution: "refund", amountPaise: 0 }, owner, provider)).rejects.toBeInstanceOf(ZodError);
  });

  it("COD orders are refunded by hand and need a UPI / bank reference", async () => {
    const cod = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }]);
    const orderId = cod.order.orderId;
    await addShipment(db(), orderId, { courier: "Delhivery", awb: "A1" }, owner);
    await updateFulfilment(db(), orderId, { to: "delivered" }, owner);
    await markCodCollected(db(), orderId, owner);
    const id = await makeCase(orderId, { type: "defective" });

    await expect(resolveSupportCase(db(), id, { resolution: "refund", amountPaise: 5000 }, owner, provider)).rejects.toThrow(/reference/);
    expect((await caseRow(id)).status).toBe("open");

    const res = await resolveSupportCase(db(), id, { resolution: "refund", amountPaise: 5000, reference: "UPI-123" }, owner, provider);
    expect(res.refund).toMatchObject({ status: "manual", amountPaise: 5000 });
    const [refund] = await db().select().from(refunds).where(eq(refunds.orderId, orderId));
    expect(refund).toMatchObject({ status: "manual", reference: "UPI-123" });
    const [mail] = (await outbox("support_case_update")).filter((m) => (m.payload as { status: string }).status === "resolved");
    expect((mail!.payload as { note: string }).note).toContain("UPI-123");
  });
});

/* ------------------------------------------------------------------------------------------ */

describe("support: resolve with a replacement order", () => {
  it("creates a linked no-charge order, decrements stock through the ledger and closes the case in one go", async () => {
    const o = await paid(); // 2 x skull, stock 10 -> 8
    expect(await stockOf(f.variants.skull!)).toBe(8);
    const [item] = await db().select().from(orderItems).where(eq(orderItems.orderId, o.order.orderId));
    const id = await makeCase(o.order.orderId);

    const res = await resolveSupportCase(
      db(),
      id,
      { resolution: "replacement", lines: [{ orderItemId: item!.id, qty: 1 }], note: "Ship with the next batch." },
      owner,
    );
    expect(res.refund).toBeNull();
    expect(res.replacement).toMatchObject({ units: 1 });
    expect(res.productIds).toEqual([item!.productId]);
    expect(await stockOf(f.variants.skull!)).toBe(7);

    const rep = await orderRow(res.replacement!.orderId);
    expect(rep.ref).toMatch(/^IFO-\d{4}-[0-9A-Z]{4}$/);
    expect(rep.ref).not.toBe(o.order.ref);
    expect(rep).toMatchObject({
      status: "confirmed",
      paymentStatus: "paid",
      fulfillmentStatus: "unfulfilled",
      subtotalPaise: 0,
      discountPaise: 0,
      shippingPaise: 0,
      codFeePaise: 0,
      totalPaise: 0,
      taxIncludedPaise: 0,
      email: "buyer@example.com",
      idempotencyKey: replacementKey(id),
      couponCode: null,
    });
    expect(rep.shippingAddress).toEqual((await orderRow(o.order.orderId)).shippingAddress);
    const repItems = await db().select().from(orderItems).where(eq(orderItems.orderId, rep.id));
    expect(repItems).toHaveLength(1);
    expect(repItems[0]).toMatchObject({ variantId: item!.variantId, qty: 1, unitPricePaise: 0, lineTotalPaise: 0, taxPaise: 0, sku: item!.sku });

    const moves = await db().select().from(inventoryMovements).where(eq(inventoryMovements.orderId, rep.id));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ delta: -1, reason: "sale", actorId: "owner-1", variantId: item!.variantId });
    expect(moves[0]!.note).toContain(o.order.ref);

    // events on both orders reference each other
    const repEvents = await db().select().from(orderEvents).where(eq(orderEvents.orderId, rep.id));
    expect(repEvents.map((e) => e.type)).toEqual(expect.arrayContaining(["order_placed", "replacement_of", "stock_decremented"]));
    expect(repEvents.find((e) => e.type === "replacement_of")!.note).toContain(o.order.ref);
    const origEvents = await db().select().from(orderEvents).where(eq(orderEvents.orderId, o.order.orderId));
    expect(origEvents.find((e) => e.type === "replacement_created")!.note).toContain(rep.ref);

    const c = await caseRow(id);
    expect(c).toMatchObject({ status: "resolved", resolution: "replacement" });
    expect(c.notes).toContain(rep.ref);
    expect(c.notes).toContain("Ship with the next batch.");
    const [mail] = (await outbox("support_case_update")).filter((m) => (m.payload as { status: string }).status === "resolved");
    expect(mail!.payload).toMatchObject({ resolution: "replacement" });
    expect((mail!.payload as { note: string }).note).toContain(rep.ref);
    expect(await outbox("order_confirmed")).toHaveLength(1); // only the original order's e-mail, none for the free one
    expect((await audit("support_case.resolve"))[0]!.diff).toMatchObject({ replacementRef: rep.ref, units: 1 });

    // the case page links to the replacement; nothing is refundable on it
    const detail = await getSupportCaseDetail(db(), id);
    expect(detail!.replacementOrder).toMatchObject({ id: rep.id, ref: rep.ref });
    const { getAdminOrderDetail } = await import("@/server/services/admin/orders");
    expect((await getAdminOrderDetail(db(), rep.id))!.actions.canRefund).toBe(false);

    await expect(
      resolveSupportCase(db(), id, { resolution: "replacement", lines: [{ orderItemId: item!.id, qty: 1 }] }, owner),
    ).rejects.toThrow(/already resolved/);
    expect(await stockOf(f.variants.skull!)).toBe(7);
  });

  it("validates lines against the original order and rolls everything back when stock is short", async () => {
    const o = await paid();
    const [item] = await db().select().from(orderItems).where(eq(orderItems.orderId, o.order.orderId));
    const id = await makeCase(o.order.orderId);

    const noLines = resolveSupportCase(db(), id, { resolution: "replacement", lines: [] }, owner);
    await expect(noLines).rejects.toBeInstanceOf(ZodError);
    await expect(
      resolveSupportCase(db(), id, { resolution: "replacement", lines: [{ orderItemId: item!.id, qty: 3 }] }, owner),
    ).rejects.toThrow(/at most 2/);
    await expect(
      resolveSupportCase(db(), id, { resolution: "replacement", lines: [{ orderItemId: crypto.randomUUID(), qty: 1 }] }, owner),
    ).rejects.toThrow(/not on the original order/);

    await db().update(variants).set({ stockOnHand: 0 }).where(eq(variants.id, item!.variantId));
    await expect(
      resolveSupportCase(db(), id, { resolution: "replacement", lines: [{ orderItemId: item!.id, qty: 1 }] }, owner),
    ).rejects.toThrow(/Not enough stock/);

    expect(await caseRow(id)).toMatchObject({ status: "open", resolution: null, notes: null });
    expect(await db().select().from(orders)).toHaveLength(1);
    expect(await outbox("support_case_update")).toHaveLength(0);
    expect(await db().select().from(inventoryMovements).where(eq(inventoryMovements.reason, "sale"))).toHaveLength(1); // the original order's
  });

  it("refuses a replacement for an order that was cancelled", async () => {
    const o = await paid();
    const [item] = await db().select().from(orderItems).where(eq(orderItems.orderId, o.order.orderId));
    const id = await makeCase(o.order.orderId);
    await db().update(orders).set({ status: "cancelled" }).where(eq(orders.id, o.order.orderId));
    await expect(
      resolveSupportCase(db(), id, { resolution: "replacement", lines: [{ orderItemId: item!.id, qty: 1 }] }, owner),
    ).rejects.toThrow(/can't be replaced/);
  });

  it("respects units held by pending checkouts (reservations count against the shelf)", async () => {
    const o = await paid(); // stock 8
    const [item] = await db().select().from(orderItems).where(eq(orderItems.orderId, o.order.orderId));
    const id = await makeCase(o.order.orderId);
    const { placePrepaidOrder } = await import("./helpers/factories");
    await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 8 }]); // reserves all 8
    await expect(
      resolveSupportCase(db(), id, { resolution: "replacement", lines: [{ orderItemId: item!.id, qty: 1 }] }, owner),
    ).rejects.toThrow(/Not enough stock/);
    expect(await stockOf(f.variants.skull!)).toBe(8);
  });

  it("merges duplicate lines and handles several lines in one go", async () => {
    const o = await placePaidOrder(provider, [
      { variantId: f.variants.skull!, qty: 2 },
      { variantId: f.variants.spiky!, qty: 1 },
    ]);
    const items = await db().select().from(orderItems).where(eq(orderItems.orderId, o.order.orderId));
    const skull = items.find((i) => i.variantId === f.variants.skull)!;
    const spiky = items.find((i) => i.variantId === f.variants.spiky)!;
    const id = await makeCase(o.order.orderId, { type: "wrong" });
    const before = { skull: await stockOf(skull.variantId), spiky: await stockOf(spiky.variantId) };
    const res = await resolveSupportCase(
      db(),
      id,
      { resolution: "replacement", lines: [{ orderItemId: skull.id, qty: 1 }, { orderItemId: skull.id, qty: 1 }, { orderItemId: spiky.id, qty: 1 }] },
      owner,
    );
    expect(res.replacement!.units).toBe(3);
    expect(await stockOf(skull.variantId)).toBe(before.skull - 2);
    expect(await stockOf(spiky.variantId)).toBe(before.spiky - 1);
    const moves = await db().select().from(inventoryMovements).where(eq(inventoryMovements.orderId, res.replacement!.orderId));
    expect(moves.map((m) => m.delta).sort((a, b) => a - b)).toEqual([-2, -1]);
  });
});

/* ------------------------------------------------------------------------------------------ */

describe("support: reject", () => {
  it("rejects with a customer-facing message, keeps an internal note and tells the customer", async () => {
    const o = await paid();
    const id = await makeCase(o.order.orderId, { type: "other" });
    await expect(rejectSupportCase(db(), id, { message: "  " }, owner)).rejects.toBeInstanceOf(ZodError);
    expect((await caseRow(id)).status).toBe("open");

    await rejectSupportCase(
      db(),
      id,
      { message: "We couldn't see any damage in the photo. Reply with a clearer one and we'll look again.", note: "Looks like normal wear." },
      admin,
    );
    const c = await caseRow(id);
    expect(c).toMatchObject({ status: "rejected", resolution: "rejected" });
    expect(c.notes).toContain("Rejected: We couldn't see any damage");
    expect(c.notes).toContain("Looks like normal wear.");
    const [mail] = await outbox("support_case_update");
    expect(mail).toMatchObject({ to: "buyer@example.com" });
    expect(mail!.payload).toMatchObject({
      status: "rejected",
      resolution: "rejected",
      note: "We couldn't see any damage in the photo. Reply with a clearer one and we'll look again.",
    });
    expect((await audit("support_case.reject"))).toHaveLength(1);
    expect(await db().select().from(refunds)).toHaveLength(0);
    await expect(rejectSupportCase(db(), id, { message: "again" }, owner)).rejects.toThrow(/already rejected/);
    await expect(
      resolveSupportCase(db(), id, { resolution: "refund", amountPaise: 100 }, owner, provider),
    ).rejects.toThrow(/already rejected/);
  });

  it("the rendered e-mail for a rejection is kind and carries the note", async () => {
    const { renderTemplate } = await import("@/server/notify/templates");
    const { fixtureContext } = await import("../../emails/fixtures");
    const r = await renderTemplate(
      "support_case_update",
      { ref: "IFO-2611-7K3Q", caseId: "c", status: "rejected", resolution: "rejected", note: "Reply with a clearer photo." },
      fixtureContext(),
    );
    expect(r.text).toContain("We could not approve this request");
    expect(r.text).toContain("Reply with a clearer photo.");
  });
});

/* ------------------------------------------------------------------------------------------ */

describe("support: RBAC", () => {
  it("fulfilment can view, assign, respond, note and start work, but not resolve or reject", async () => {
    const o = await paid();
    const [item] = await db().select().from(orderItems).where(eq(orderItems.orderId, o.order.orderId));
    const id = await makeCase(o.order.orderId);

    await assignSupportCase(db(), id, { assignedTo: "ful-1" }, fulfilment);
    await setSupportCaseStatus(db(), id, { status: "in_progress" }, fulfilment);
    await respondToSupportCase(db(), id, { message: "Looking into it." }, fulfilment);
    await addSupportCaseNote(db(), id, { note: "Checked photos." }, fulfilment);

    await expect(
      resolveSupportCase(db(), id, { resolution: "refund", amountPaise: 100 }, fulfilment, provider),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      resolveSupportCase(db(), id, { resolution: "replacement", lines: [{ orderItemId: item!.id, qty: 1 }] }, fulfilment),
    ).rejects.toThrow(/Forbidden/);
    await expect(rejectSupportCase(db(), id, { message: "no" }, fulfilment)).rejects.toThrow(/Forbidden/);

    expect(await caseRow(id)).toMatchObject({ status: "in_progress", resolution: null });
    expect(await db().select().from(refunds)).toHaveLength(0);
    expect(await stockOf(f.variants.skull!)).toBe(8);
  });

  it("roles without any support permission are refused everywhere", async () => {
    const o = await paid();
    const id = await makeCase(o.order.orderId);
    const mid = await makeMessage();
    const customer = { id: "cust-1", role: "customer" };
    await expect(assignSupportCase(db(), id, { assignedTo: null }, customer)).rejects.toThrow(/Forbidden/);
    await expect(respondToSupportCase(db(), id, { message: "x" }, customer)).rejects.toThrow(/Forbidden/);
    await expect(setSupportCaseStatus(db(), id, { status: "in_progress" }, customer)).rejects.toThrow(/Forbidden/);
    await expect(addSupportCaseNote(db(), id, { note: "x" }, customer)).rejects.toThrow(/Forbidden/);
    await expect(replyToContactMessage(db(), mid, { message: "x" }, customer)).rejects.toThrow(/Forbidden/);
    await expect(setContactMessageStatus(db(), mid, { status: "open" }, customer)).rejects.toThrow(/Forbidden/);
    await expect(assignContactMessage(db(), mid, { assignedTo: null }, customer)).rejects.toThrow(/Forbidden/);
    await expect(addContactMessageNote(db(), mid, { note: "x" }, customer)).rejects.toThrow(/Forbidden/);
    expect(await outbox("support_case_update")).toHaveLength(0);
    expect(await outbox("contact_reply")).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------------------------ */

describe("support: photos from the private bucket", () => {
  it("degrades gracefully when storage is not configured: no URL, file name kept", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const photos = await signCasePhotos(["support/c1/front.jpg", "support/c1/receipt.pdf"]);
    expect(photos).toEqual([
      { path: "support/c1/front.jpg", name: "front.jpg", url: null, isImage: true },
      { path: "support/c1/receipt.pdf", name: "receipt.pdf", url: null, isImage: false },
    ]);
  });

  it("asks storage for 10-minute signed URLs from the private bucket and survives a failing file", async () => {
    vi.stubEnv("SUPABASE_URL", "http://storage.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body?: string }) => {
        calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
        if (url.includes("broken")) return new Response(JSON.stringify({ message: "Object not found" }), { status: 404 });
        return new Response(JSON.stringify({ signedURL: "/object/sign/private/x?token=t" }), { status: 200 });
      }),
    );
    const photos = await signCasePhotos(["support/c1/a.png", "support/c1/broken.png"]);
    expect(photos[0]).toMatchObject({ name: "a.png", isImage: true });
    expect(photos[0]!.url).toBe("http://storage.test/storage/v1/object/sign/private/x?token=t");
    expect(photos[1]).toMatchObject({ name: "broken.png", url: null });
    expect(calls[0]!.url).toBe("http://storage.test/storage/v1/object/sign/private/support/c1/a.png");
    expect(calls[0]!.body).toEqual({ expiresIn: 600 });
  });
});

/* ------------------------------------------------------------------------------------------ */

describe("support: dashboard", () => {
  it("counts open and in-progress cases only", async () => {
    const o = await paid();
    expect((await getDashboardStats(db(), { withActivity: false })).openSupportCases).toBe(0);
    const a = await makeCase(o.order.orderId);
    await makeCase(o.order.orderId, { status: "in_progress" });
    await makeCase(o.order.orderId, { status: "resolved", resolution: "refund" });
    await makeCase(o.order.orderId, { status: "rejected", resolution: "rejected" });
    expect((await getDashboardStats(db(), { withActivity: false })).openSupportCases).toBe(2);
    await rejectSupportCase(db(), a, { message: "Not covered." }, owner);
    expect((await getDashboardStats(db(), { withActivity: false })).openSupportCases).toBe(1);
  });

  it("replacement orders are fulfilment work but not sales", async () => {
    const o = await paid();
    const [item] = await db().select().from(orderItems).where(eq(orderItems.orderId, o.order.orderId));
    const id = await makeCase(o.order.orderId);
    const before = await getDashboardStats(db(), { withActivity: false });
    await resolveSupportCase(db(), id, { resolution: "replacement", lines: [{ orderItemId: item!.id, qty: 1 }] }, owner);
    const after = await getDashboardStats(db(), { withActivity: false });
    expect(after.sales.week).toEqual(before.sales.week);
    expect(after.sales.aovPaise).toBe(before.sales.aovPaise);
    expect(after.awaitingFulfilment.unfulfilled).toBe(before.awaitingFulfilment.unfulfilled + 1);
  });
});
