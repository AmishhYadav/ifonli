import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { getDb } from "@/server/db";
import {
  addresses,
  adminAuditLog,
  contactMessages,
  customerProfiles,
  orders,
  session,
  supportCases,
  user,
  wishlistItems,
} from "@/server/db/schema";
import {
  CUSTOMER_PAGE_SIZE,
  CustomerNotFoundError,
  GUEST_DELETE_REFUSAL,
  deleteCustomerForStaff,
  exportCustomerForStaff,
  getCustomerDetail,
  guestRef,
  listCustomers,
  resolveCustomer,
} from "@/server/services/admin/customers";
import { getAdminOrderDetail } from "@/server/services/admin/orders";
import { AdminInputError } from "@/server/services/admin/products";
import { replacementKey } from "@/server/services/replacement-orders";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";

const db = () => getDb();
const owner = { id: "owner-1", role: "owner", ip: "10.0.0.1" };
const admin = { id: "admin-1", role: "admin" };
const fulfilment = { id: "ful-1", role: "fulfilment" };

let f: Fixture;
let seq = 0;

const DAY = 86_400_000;
const t0 = new Date("2026-10-01T10:00:00Z");
const at = (days: number) => new Date(t0.getTime() + days * DAY);

type OrderValues = typeof orders.$inferInsert;

/** Inserts an order straight into the database (statuses and amounts are what the test says). */
async function makeOrder(email: string, o: Partial<OrderValues> & { name?: string } = {}) {
  seq += 1;
  const { name, ...rest } = o;
  const total = rest.totalPaise ?? 10_000;
  const [row] = await db()
    .insert(orders)
    .values({
      ref: `IFO-2610-${String(seq).padStart(4, "0")}`,
      email,
      phone: "9876543210",
      status: "confirmed",
      paymentStatus: "paid",
      fulfillmentStatus: "unfulfilled",
      paymentMethod: "razorpay",
      subtotalPaise: total,
      totalPaise: total,
      shippingAddress: {
        name: name ?? "Guest Buyer",
        line1: "1 Road",
        city: "Mumbai",
        pincode: "400001",
      },
      idempotencyKey: `test-${seq}`,
      placedAt: at(seq),
      ...rest,
    })
    .returning();
  return row!;
}

async function makeAccount(
  id: string,
  name: string,
  email: string,
  extra: Partial<typeof user.$inferInsert> = {},
) {
  await db()
    .insert(user)
    .values({ id, name, email, emailVerified: true, ...extra });
}

beforeEach(async () => {
  f = await seedCatalogFixture();
  seq = 0;
  await db()
    .insert(user)
    .values([
      {
        id: "owner-1",
        name: "Owner",
        email: "owner@ifonli.test",
        role: "owner",
        emailVerified: true,
      },
      {
        id: "admin-1",
        name: "Admin",
        email: "admin@ifonli.test",
        role: "admin",
        emailVerified: true,
      },
      {
        id: "ful-1",
        name: "Packer",
        email: "packer@ifonli.test",
        role: "fulfilment",
        emailVerified: true,
      },
    ]);
});

describe("listCustomers", () => {
  it("lists accounts and guests once each, keyed by e-mail, with a badge-ready kind", async () => {
    await makeAccount("c-asha", "Asha Rao", "asha@example.com");
    await makeAccount("c-new", "Newcomer", "new@example.com");
    // A linked order, plus a guest order placed with the account's e-mail before signing up.
    await makeOrder("asha@example.com", { userId: "c-asha", totalPaise: 20_000 });
    await makeOrder("ASHA@example.com", { totalPaise: 5_000 });
    // Two orders by one guest (differently cased e-mail), one by another.
    await makeOrder("Guest.One@Example.com", { name: "Gita One", totalPaise: 7_000 });
    await makeOrder("guest.one@example.com", { name: "Gita One", totalPaise: 3_000 });
    await makeOrder("guest.two@example.com", { name: "Gopal Two" });

    const list = await listCustomers(db());
    expect(list.total).toBe(4);
    const byEmail = Object.fromEntries(list.items.map((r) => [r.email.toLowerCase(), r]));
    expect(Object.keys(byEmail).sort()).toEqual([
      "asha@example.com",
      "guest.one@example.com",
      "guest.two@example.com",
      "new@example.com",
    ]);
    expect(byEmail["asha@example.com"]).toMatchObject({
      kind: "account",
      ref: "c-asha",
      name: "Asha Rao",
      orderCount: 2,
      lifetimeValuePaise: 25_000,
    });
    expect(byEmail["guest.one@example.com"]).toMatchObject({
      kind: "guest",
      name: "Gita One",
      orderCount: 2,
      lifetimeValuePaise: 10_000,
    });
    expect(byEmail["guest.one@example.com"]!.ref).toMatch(/^o-[0-9a-f-]{36}$/);
    // An account that never ordered is still a customer.
    expect(byEmail["new@example.com"]).toMatchObject({
      kind: "account",
      orderCount: 0,
      lifetimeValuePaise: 0,
      lastOrderAt: null,
    });
  });

  it("never lists staff, and never makes a customer of a staff member's orders", async () => {
    await makeOrder("admin@ifonli.test", { userId: "admin-1" });
    await makeOrder("owner@ifonli.test"); // a test order typed with the owner's e-mail, not linked
    await makeAccount("c-1", "Real Customer", "real@example.com");
    const list = await listCustomers(db());
    expect(list.items.map((r) => r.email)).toEqual(["real@example.com"]);
    expect(await listCustomers(db(), { q: "owner" })).toMatchObject({ total: 0 });
    expect(await listCustomers(db(), { q: "admin" })).toMatchObject({ total: 0 });
  });

  it("counts a sale like the dashboard: no replacements, refunds, cancellations or abandoned checkouts", async () => {
    await makeAccount("c-1", "Buyer", "buyer@example.com");
    const base = { userId: "c-1" } as const;
    await makeOrder("buyer@example.com", { ...base, totalPaise: 10_000 }); // counted
    await makeOrder("buyer@example.com", {
      ...base,
      totalPaise: 4_000,
      status: "completed",
      paymentStatus: "cod_collected",
    }); // counted
    await makeOrder("buyer@example.com", {
      ...base,
      totalPaise: 2_000,
      paymentStatus: "partially_refunded",
    }); // counted (as on the dashboard)
    await makeOrder("buyer@example.com", {
      ...base,
      totalPaise: 90_000,
      paymentStatus: "refunded",
    });
    await makeOrder("buyer@example.com", {
      ...base,
      totalPaise: 80_000,
      status: "cancelled",
      paymentStatus: "refunded",
    });
    await makeOrder("buyer@example.com", {
      ...base,
      totalPaise: 70_000,
      status: "cancelled",
      paymentStatus: "unpaid",
    });
    await makeOrder("buyer@example.com", { ...base, totalPaise: 60_000, paymentStatus: "failed" });
    await makeOrder("buyer@example.com", {
      ...base,
      totalPaise: 50_000,
      status: "pending_payment",
      paymentStatus: "unpaid",
    });
    await makeOrder("buyer@example.com", {
      ...base,
      totalPaise: 40_000,
      status: "expired",
      paymentStatus: "unpaid",
    });
    await makeOrder("buyer@example.com", {
      ...base,
      totalPaise: 0,
      idempotencyKey: replacementKey(crypto.randomUUID()),
    });

    const [row] = (await listCustomers(db())).items;
    expect(row).toMatchObject({ kind: "account", orderCount: 3, lifetimeValuePaise: 16_000 });

    // The last order is the latest real order (the replacement, placed last); abandoned checkouts do not count.
    expect(row!.lastOrderAt?.getTime()).toBe(at(10).getTime());

    // The detail agrees with the list.
    const detail = await getCustomerDetail(db(), "c-1");
    expect(detail!.stats).toMatchObject({ orderCount: 3, lifetimeValuePaise: 16_000 });
    expect(detail!.orders.filter((o) => o.counted)).toHaveLength(3);
    expect(detail!.orders.filter((o) => o.isReplacement)).toHaveLength(1);
  });

  it("leaves guests whose only checkouts never completed off the list", async () => {
    await makeOrder("ghost@example.com", { status: "pending_payment", paymentStatus: "unpaid" });
    await makeOrder("ghost2@example.com", { status: "expired", paymentStatus: "unpaid" });
    await makeOrder("cancelled@example.com", { status: "cancelled", paymentStatus: "refunded" });
    const list = await listCustomers(db());
    expect(list.items.map((r) => r.email)).toEqual(["cancelled@example.com"]);
    expect(list.items[0]).toMatchObject({ kind: "guest", orderCount: 0, lifetimeValuePaise: 0 });
  });

  it("searches name, e-mail and phone (accounts, guests and names typed on orders)", async () => {
    await makeAccount("c-asha", "Asha Rao", "asha@example.com");
    await db().insert(customerProfiles).values({ userId: "c-asha", phone: "9811122233" });
    await makeAccount("c-bela", "Bela Shah", "bela@example.com");
    await makeOrder("guest@example.com", { name: "Gulab Jamun", phone: "+91 98765 00001" });
    await makeOrder("asha@example.com", { userId: "c-asha", name: "Ashu (office)" });

    const emails = async (q: string) =>
      (await listCustomers(db(), { q })).items.map((r) => r.email).sort();
    expect(await emails("asha")).toEqual(["asha@example.com"]);
    expect(await emails("SHAH")).toEqual(["bela@example.com"]);
    expect(await emails("gulab")).toEqual(["guest@example.com"]);
    expect(await emails("ashu")).toEqual(["asha@example.com"]); // a name used on one of their orders
    expect(await emails("@example.com")).toHaveLength(3);
    expect(await emails("98111 22233")).toEqual(["asha@example.com"]); // profile phone, spaces ignored
    expect(await emails("9876500001")).toEqual(["guest@example.com"]); // order phone, "+91 " formatting ignored
    expect(await emails("nobody-like-this")).toEqual([]);
    // LIKE wildcards are plain characters.
    expect(await emails("%")).toEqual([]);
    expect(await emails("_")).toEqual([]);
    // Kind filter.
    expect((await listCustomers(db(), { kind: "guest" })).items.map((r) => r.email)).toEqual([
      "guest@example.com",
    ]);
    expect((await listCustomers(db(), { kind: "account" })).total).toBe(2);
  });

  it("sorts by last order, total spent and joined, both ways, and paginates", async () => {
    await makeAccount("c-a", "A Early", "a@example.com", { createdAt: at(-30) });
    await makeAccount("c-b", "B Late", "b@example.com", { createdAt: at(-5) });
    await makeOrder("a@example.com", { userId: "c-a", totalPaise: 50_000 }); // day 1
    await makeOrder("g@example.com", { totalPaise: 90_000 }); // day 2: guest, first order day 2
    await makeOrder("b@example.com", { userId: "c-b", totalPaise: 1_000 }); // day 3
    await makeAccount("c-z", "Z Never", "z@example.com", { createdAt: at(-60) });

    const order = async (sort: "last_order" | "spent" | "joined", dir?: "asc" | "desc") =>
      (await listCustomers(db(), { sort, dir })).items.map((r) => r.email);

    expect(await order("last_order")).toEqual([
      "b@example.com",
      "g@example.com",
      "a@example.com",
      "z@example.com",
    ]);
    expect(await order("last_order", "asc")).toEqual([
      "a@example.com",
      "g@example.com",
      "b@example.com",
      "z@example.com",
    ]); // never-ordered last either way
    expect(await order("spent")).toEqual([
      "g@example.com",
      "a@example.com",
      "b@example.com",
      "z@example.com",
    ]);
    expect(await order("spent", "asc")).toEqual([
      "z@example.com",
      "b@example.com",
      "a@example.com",
      "g@example.com",
    ]);
    // Joined: account creation, or a guest's first order.
    expect(await order("joined")).toEqual([
      "g@example.com",
      "b@example.com",
      "a@example.com",
      "z@example.com",
    ]);
    expect(await order("joined", "asc")).toEqual([
      "z@example.com",
      "a@example.com",
      "b@example.com",
      "g@example.com",
    ]);
    // A junk sort falls back to the default instead of reaching SQL.
    const junk = await listCustomers(db(), {
      sort: "x; drop table orders" as never,
      dir: "sideways" as never,
    });
    expect(junk.items.map((r) => r.email)).toEqual(await order("last_order"));

    const p1 = await listCustomers(db(), { sort: "spent", pageSize: 2 });
    const p2 = await listCustomers(db(), { sort: "spent", pageSize: 2, page: 2 });
    const p9 = await listCustomers(db(), { sort: "spent", pageSize: 2, page: 9 });
    expect([p1.total, p1.pageCount, p1.items.length, p2.items.length]).toEqual([4, 2, 2, 2]);
    expect(p1.items.map((r) => r.email).concat(p2.items.map((r) => r.email))).toEqual(
      await order("spent"),
    );
    expect(p9.page).toBe(2);
    expect(CUSTOMER_PAGE_SIZE).toBe(25);
  });
});

describe("getCustomerDetail", () => {
  it("shows the profile, addresses, orders, wishlist, support cases and messages of an account", async () => {
    await makeAccount("c-asha", "Asha Rao", "asha@example.com", { createdAt: at(-10) });
    await db()
      .insert(customerProfiles)
      .values({ userId: "c-asha", phone: "9811122233", marketingOptIn: true });
    await db()
      .insert(addresses)
      .values([
        {
          userId: "c-asha",
          name: "Asha Rao",
          phone: "9811122233",
          line1: "Home 1",
          city: "Mumbai",
          state: "Maharashtra",
          pincode: "400001",
        },
        {
          userId: "c-asha",
          name: "Asha Rao",
          phone: "9811122233",
          line1: "Office 2",
          city: "Pune",
          state: "Maharashtra",
          pincode: "411001",
          isDefault: true,
        },
      ]);
    await db()
      .insert(wishlistItems)
      .values([{ userId: "c-asha", productId: f.products["skull-charm"]! }]);
    await db()
      .insert(session)
      .values([
        { id: "s1", userId: "c-asha", token: "t1", expiresAt: at(30), createdAt: at(1) },
        { id: "s2", userId: "c-asha", token: "t2", expiresAt: at(30), createdAt: at(5) },
      ]);
    const o1 = await makeOrder("asha@example.com", { userId: "c-asha", totalPaise: 12_000 });
    const o2 = await makeOrder("asha@example.com", { totalPaise: 8_000 }); // pre-signup guest order, same e-mail
    await makeOrder("bela@example.com", { name: "Bela" }); // someone else's
    const [kase] = await db()
      .insert(supportCases)
      .values({ orderId: o1.id, type: "damaged", description: "Cracked" })
      .returning();
    await db()
      .insert(contactMessages)
      .values([
        {
          name: "Asha",
          email: "ASHA@example.com",
          message: "Where is my parcel?\n\nIt is late.",
          orderRef: o2.ref,
        },
        { name: "Bela", email: "bela@example.com", message: "hello" },
      ]);

    const d = await getCustomerDetail(db(), "c-asha");
    expect(d).not.toBeNull();
    expect(d).toMatchObject({
      ref: "c-asha",
      kind: "account",
      name: "Asha Rao",
      email: "asha@example.com",
      phone: "9811122233",
      canDelete: true,
      wishlistCount: 1,
      stats: { orderCount: 2, lifetimeValuePaise: 20_000 },
    });
    expect(d!.account).toMatchObject({
      id: "c-asha",
      emailVerified: true,
      marketingOptIn: true,
      banned: false,
    });
    expect(d!.account!.lastSignInAt?.getTime()).toBe(at(5).getTime());
    expect(d!.addresses.map((a) => a.line1)).toEqual(["Office 2", "Home 1"]); // default first
    expect(d!.orders.map((o) => o.id).sort()).toEqual([o1.id, o2.id].sort());
    expect(d!.orders[0]!.placedAt.getTime()).toBeGreaterThan(d!.orders[1]!.placedAt.getTime());
    expect(d!.supportCases).toEqual([
      expect.objectContaining({ id: kase!.id, orderRef: o1.ref, type: "damaged", status: "open" }),
    ]);
    expect(d!.contactMessages).toHaveLength(1);
    expect(d!.contactMessages[0]).toMatchObject({
      orderRef: o2.ref,
      snippet: "Where is my parcel? It is late.",
    });
  });

  it("shows a guest by any of their orders, with the name and phone from the latest one", async () => {
    const first = await makeOrder("guest@example.com", { name: "Old Name", phone: "9000000001" });
    const last = await makeOrder("GUEST@example.com", { name: "New Name", phone: "9000000002" });
    await makeOrder("other@example.com");
    await db()
      .insert(contactMessages)
      .values({ name: "G", email: "guest@example.com", message: "hi" });

    for (const id of [first.id, last.id]) {
      const d = await getCustomerDetail(db(), guestRef(id));
      expect(d).toMatchObject({
        kind: "guest",
        name: "New Name",
        email: "guest@example.com",
        phone: "9000000002",
        account: null,
        canDelete: false,
        addresses: [],
        wishlistCount: 0,
        stats: { orderCount: 2 },
      });
      expect(d!.orders).toHaveLength(2);
      expect(d!.contactMessages).toHaveLength(1);
      expect(d!.firstOrderAt?.getTime()).toBe(first.placedAt.getTime());
    }
  });

  it("follows a guest reference to the account once that e-mail has one, and never resolves staff", async () => {
    const o = await makeOrder("later@example.com");
    expect((await resolveCustomer(db(), guestRef(o.id)))?.kind).toBe("guest");
    await makeAccount("c-later", "Later", "later@example.com");
    expect(await resolveCustomer(db(), guestRef(o.id))).toMatchObject({
      kind: "account",
      ref: "c-later",
    });

    const adminOrder = await makeOrder("admin@ifonli.test", { userId: "admin-1" });
    expect(await resolveCustomer(db(), guestRef(adminOrder.id))).toBeNull();
    const unlinked = await makeOrder("owner@ifonli.test");
    expect(await resolveCustomer(db(), guestRef(unlinked.id))).toBeNull();
    for (const id of ["admin-1", "owner-1", "ful-1"]) {
      expect(await resolveCustomer(db(), id)).toBeNull();
      expect(await getCustomerDetail(db(), id)).toBeNull();
    }
    expect(await getCustomerDetail(db(), "nope")).toBeNull();
    expect(await getCustomerDetail(db(), `o-${crypto.randomUUID()}`)).toBeNull();
    expect(await getCustomerDetail(db(), "x".repeat(300))).toBeNull();
  });
});

describe("export (DPDP access request)", () => {
  async function seedAsha() {
    await makeAccount("c-asha", "Asha Rao", "asha@example.com");
    await db().insert(customerProfiles).values({ userId: "c-asha", phone: "9811122233" });
    await db().insert(addresses).values({
      userId: "c-asha",
      name: "Asha Rao",
      phone: "9811122233",
      line1: "Home 1",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
    });
    const o = await makeOrder("asha@example.com", { userId: "c-asha" });
    await db()
      .insert(supportCases)
      .values({
        orderId: o.id,
        type: "damaged",
        description: "Cracked",
        notes: "internal: repeat claimant",
      });
    await db()
      .insert(contactMessages)
      .values({ name: "Asha", email: "asha@example.com", message: "Hello" });
    return o;
  }

  it("exports an account through exportCustomerData and audits it with counts only", async () => {
    const o = await seedAsha();
    const file = await exportCustomerForStaff(db(), "c-asha", owner);
    expect(file.filename).toMatch(/^ifonli-customer-account-c-asha-\d{4}-\d{2}-\d{2}\.json$/);
    expect(file.filename).not.toContain("asha@");
    const data = JSON.parse(file.content);
    expect(data.account).toMatchObject({ id: "c-asha", email: "asha@example.com" });
    expect(data.orders.map((x: { ref: string }) => x.ref)).toEqual([o.ref]);
    expect(data.supportCases).toHaveLength(1);
    expect(file.content).not.toContain("repeat claimant"); // staff notes never leave
    expect(data.contactMessages).toHaveLength(1);

    const rows = await db()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "customer.export"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: "owner-1",
      entity: "user",
      entityId: "c-asha",
      ip: "10.0.0.1",
    });
    expect(rows[0]!.diff).toEqual({
      by: "staff",
      actorUserId: "owner-1",
      kind: "account",
      orders: 1,
      addresses: 1,
      wishlistItems: 0,
      supportCases: 1,
      contactMessages: 1,
    });
    const logged = JSON.stringify(rows);
    for (const secret of ["asha@example.com", "Asha Rao", "9811122233", "Home 1"])
      expect(logged).not.toContain(secret);
  });

  it("exports a guest's orders, cases and messages (and only theirs)", async () => {
    const o = await makeOrder("guest@example.com", { name: "Guest G" });
    await makeOrder("someone@example.com");
    await db()
      .insert(supportCases)
      .values({ orderId: o.id, type: "other", description: "Question" });
    await db()
      .insert(contactMessages)
      .values({ name: "G", email: "Guest@Example.com", message: "Hi there" });

    const file = await exportCustomerForStaff(db(), guestRef(o.id), admin);
    expect(file.filename).toMatch(/^ifonli-customer-guest-[0-9a-f]{8}-/);
    const data = JSON.parse(file.content);
    expect(data.guest).toEqual({ email: "guest@example.com" });
    expect(data.orders.map((x: { ref: string }) => x.ref)).toEqual([o.ref]);
    expect(data.supportCases).toHaveLength(1);
    expect(data.contactMessages).toHaveLength(1);

    const [row] = await db()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "customer.export"));
    expect(row).toMatchObject({ actorId: "admin-1", entity: "guest_customer", entityId: o.id });
    expect(row!.diff).toEqual({
      by: "staff",
      actorUserId: "admin-1",
      kind: "guest",
      orders: 1,
      supportCases: 1,
      contactMessages: 1,
    });
    expect(JSON.stringify(row)).not.toContain("guest@example.com");
  });

  it("is refused without customer:export, leaving no audit row and no data", async () => {
    await seedAsha();
    await expect(exportCustomerForStaff(db(), "c-asha", fulfilment)).rejects.toThrow(/Forbidden/);
    await expect(
      exportCustomerForStaff(db(), "c-asha", { id: "x", role: "customer" }),
    ).rejects.toThrow(/Forbidden/);
    expect(
      await db().select().from(adminAuditLog).where(eq(adminAuditLog.action, "customer.export")),
    ).toHaveLength(0);
  });

  it("refuses staff accounts and unknown customers", async () => {
    await expect(exportCustomerForStaff(db(), "admin-1", owner)).rejects.toBeInstanceOf(
      CustomerNotFoundError,
    );
    await expect(exportCustomerForStaff(db(), "ghost", owner)).rejects.toBeInstanceOf(
      CustomerNotFoundError,
    );
    expect(await db().select().from(adminAuditLog)).toHaveLength(0);
  });
});

describe("delete account (DPDP erasure request)", () => {
  async function seedBela() {
    await makeAccount("c-bela", "Bela Shah", "bela@example.com");
    await db().insert(customerProfiles).values({ userId: "c-bela", phone: "9811100000" });
    await db().insert(addresses).values({
      userId: "c-bela",
      name: "Bela",
      phone: "9811100000",
      line1: "Flat 4",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
    });
    await db()
      .insert(session)
      .values({ id: "sb", userId: "c-bela", token: "tb", expiresAt: at(30) });
    return makeOrder("bela@example.com", { userId: "c-bela", name: "Bela Shah" });
  }

  it("deletes the account through deleteCustomerAccount, keeps the order unlinked, and audits it", async () => {
    const o = await seedBela();
    const result = await deleteCustomerForStaff(
      db(),
      "c-bela",
      { confirm: "  Bela@Example.com " },
      owner,
    );
    expect(result).toEqual({ ordersRetained: 1 });

    expect(await db().select().from(user).where(eq(user.id, "c-bela"))).toHaveLength(0);
    expect(await db().select().from(addresses).where(eq(addresses.userId, "c-bela"))).toHaveLength(
      0,
    );
    expect(await db().select().from(session).where(eq(session.userId, "c-bela"))).toHaveLength(0);
    const [kept] = await db().select().from(orders).where(eq(orders.id, o.id));
    expect(kept).toMatchObject({ userId: null, email: "bela@example.com" });

    const rows = await db()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "customer.delete"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: "owner-1", entity: "user", entityId: "c-bela" });
    expect(rows[0]!.diff).toMatchObject({ by: "staff", actorUserId: "owner-1", ordersRetained: 1 });
    expect(JSON.stringify(rows)).not.toContain("bela@example.com");

    // The buyer is now a guest in the list: the orders are still on file.
    const list = await listCustomers(db(), { q: "bela" });
    expect(list.items).toEqual([expect.objectContaining({ kind: "guest", orderCount: 1 })]);
  });

  it("needs the e-mail typed exactly, and customer:delete", async () => {
    await seedBela();
    await expect(
      deleteCustomerForStaff(db(), "c-bela", { confirm: "bela@example.org" }, owner),
    ).rejects.toBeInstanceOf(AdminInputError);
    await expect(
      deleteCustomerForStaff(db(), "c-bela", { confirm: "" }, owner),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(deleteCustomerForStaff(db(), "c-bela", {}, owner)).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(
      deleteCustomerForStaff(db(), "c-bela", { confirm: "bela@example.com" }, fulfilment),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      deleteCustomerForStaff(
        db(),
        "c-bela",
        { confirm: "bela@example.com" },
        { id: "c", role: "customer" },
      ),
    ).rejects.toThrow(/Forbidden/);
    expect(await db().select().from(user).where(eq(user.id, "c-bela"))).toHaveLength(1);
    expect(
      await db().select().from(adminAuditLog).where(eq(adminAuditLog.action, "customer.delete")),
    ).toHaveLength(0);
  });

  it("refuses to delete guest order data (retention, D-DPDP-1)", async () => {
    const o = await makeOrder("guest@example.com");
    await expect(
      deleteCustomerForStaff(db(), guestRef(o.id), { confirm: "guest@example.com" }, owner),
    ).rejects.toThrow(GUEST_DELETE_REFUSAL);
    expect(await db().select().from(orders).where(eq(orders.id, o.id))).toHaveLength(1);
    expect(await db().select().from(adminAuditLog)).toHaveLength(0);
    expect((await getCustomerDetail(db(), guestRef(o.id)))!.canDelete).toBe(false);
  });

  it("refuses staff accounts, even when named directly", async () => {
    for (const [id, email] of [
      ["admin-1", "admin@ifonli.test"],
      ["owner-1", "owner@ifonli.test"],
      ["ful-1", "packer@ifonli.test"],
    ] as const) {
      await expect(
        deleteCustomerForStaff(db(), id, { confirm: email }, owner),
      ).rejects.toBeInstanceOf(CustomerNotFoundError);
      expect(
        await db()
          .select()
          .from(user)
          .where(and(eq(user.id, id))),
      ).toHaveLength(1);
    }
    expect(await db().select().from(adminAuditLog)).toHaveLength(0);
  });
});

describe("admin order detail: support cases and replacements", () => {
  it("lists the order's support cases and links a replacement order both ways", async () => {
    const original = await makeOrder("buyer@example.com");
    const [withReplacement, plain] = await db()
      .insert(supportCases)
      .values([
        {
          orderId: original.id,
          type: "defective",
          description: "Clasp broken",
          status: "resolved",
          resolution: "replacement",
        },
        { orderId: original.id, type: "other", description: "Question" },
      ])
      .returning();
    const replacement = await makeOrder("buyer@example.com", {
      totalPaise: 0,
      idempotencyKey: replacementKey(withReplacement!.id),
    });
    // Another order's case must not leak in.
    const other = await makeOrder("other@example.com");
    await db().insert(supportCases).values({ orderId: other.id, type: "damaged", description: "Cracked" });

    const forOriginal = await getAdminOrderDetail(db(), original.id);
    expect(forOriginal!.supportCases.map((c) => c.id).sort()).toEqual(
      [withReplacement!.id, plain!.id].sort(),
    );
    expect(forOriginal!.supportCases.find((c) => c.id === withReplacement!.id)).toMatchObject({
      type: "defective",
      status: "resolved",
      resolution: "replacement",
    });
    expect(forOriginal!.replacements).toEqual([
      { orderId: replacement.id, ref: replacement.ref, caseId: withReplacement!.id },
    ]);
    expect(forOriginal!.replacementFor).toBeNull();

    const forReplacement = await getAdminOrderDetail(db(), replacement.id);
    expect(forReplacement!.replacementFor).toEqual({
      orderId: original.id,
      ref: original.ref,
      caseId: withReplacement!.id,
    });
    expect(forReplacement!.replacements).toEqual([]);
    expect(forReplacement!.supportCases).toEqual([]);

    const forOther = await getAdminOrderDetail(db(), other.id);
    expect(forOther!.supportCases).toHaveLength(1);
    expect(forOther!.replacements).toEqual([]);
  });

  it("ignores a malformed replacement key", async () => {
    const odd = await makeOrder("odd@example.com", { idempotencyKey: "replacement:not-a-case" });
    const detail = await getAdminOrderDetail(db(), odd.id);
    expect(detail!.replacementFor).toBeNull();
  });
});
