import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import {
  account,
  addresses,
  adminAuditLog,
  carts,
  contactMessages,
  customerProfiles,
  orderItems,
  orders,
  session,
  supportCases,
  user,
  verification,
  wishlistItems,
} from "@/server/db/schema";
import { createAddress, updateProfile } from "@/server/services/account";
import { deleteCustomerAccount, exportCustomerData } from "@/server/services/dpdp";
import { replaceAccountWishlist } from "@/server/services/wishlist";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { configureCommerce, makeCart, placeCodOrder, seedCommerceReference } from "./helpers/factories";

const db = () => getDb();
let f: Fixture;

beforeEach(async () => {
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
  await db()
    .insert(user)
    .values([
      { id: "cust-a", name: "Asha Rao", email: "asha@example.com", emailVerified: true },
      { id: "cust-b", name: "Bela", email: "bela@example.com", emailVerified: true },
      { id: "admin-1", name: "Admin", email: "admin@example.com", role: "admin" },
    ]);
});

/** A customer with a profile, an address, a wishlist heart, a session, an order and a support case. */
async function populate(userId: string, email: string) {
  await updateProfile(db(), userId, { name: "Asha Rao", phone: "9876543210", marketingOptIn: true });
  await createAddress(db(), userId, {
    name: "Asha Rao",
    phone: "9876543210",
    line1: "12 Marine Drive",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400001",
  });
  await replaceAccountWishlist(db(), userId, [{ id: f.products["skull-charm"]!, addedAt: Date.now() }]);
  await db().insert(session).values({
    id: `s-${userId}`,
    userId,
    token: `tok-${userId}`,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await db().insert(account).values({ id: `a-${userId}`, accountId: userId, providerId: "credential", userId });
  await db().insert(verification).values({
    id: `v-${userId}`,
    identifier: `sign-in-otp-${email}`,
    value: "123456:0",
    expiresAt: new Date(Date.now() + 600_000),
  });
  await makeCart([{ variantId: f.variants.skull!, qty: 1 }], { userId });
  const placed = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }], { form: { email } });
  await db().update(orders).set({ userId }).where(eq(orders.id, placed.order.orderId));
  await db().insert(supportCases).values({
    orderId: placed.order.orderId,
    type: "damaged",
    description: "Arrived cracked",
    photoPaths: ["support/x/y.jpg"],
    notes: "internal note: possible repeat claimant",
  });
  await db().insert(contactMessages).values({ name: "Asha", email, message: "Where is my order please" });
  return placed;
}

describe("export my data", () => {
  it("returns the customer's own data and nothing internal", async () => {
    const mine = await populate("cust-a", "asha@example.com");
    await populate("cust-b", "bela@example.com");

    const data = await exportCustomerData(db(), "cust-a");
    expect(data).not.toBeNull();
    if (!data) return;
    expect(data.account).toMatchObject({ id: "cust-a", email: "asha@example.com", name: "Asha Rao" });
    expect(data.profile).toEqual({ phone: "+919876543210", marketingOptIn: true });
    expect(data.addresses).toHaveLength(1);
    expect(data.addresses[0]).toMatchObject({ line1: "12 Marine Drive", isDefault: true });
    expect(data.orders.map((o) => o.ref)).toEqual([mine.order.ref]);
    expect(data.orders[0]!.items).toHaveLength(1);
    expect(data.wishlist).toHaveLength(1);
    expect(data.wishlist[0]).toMatchObject({ productId: f.products["skull-charm"], productName: "Skull Charm" });
    expect(data.supportCases).toEqual([
      expect.objectContaining({ orderRef: mine.order.ref, type: "damaged", photos: 1 }),
    ]);
    expect(data.contactMessages).toHaveLength(1);

    // no secrets, no staff notes, nothing of the other customer
    const json = JSON.stringify(data);
    expect(json).not.toContain("internal note");
    expect(json).not.toContain("tok-cust-a");
    expect(json).not.toContain("bela@example.com");
    expect(json).not.toContain("accessTokenHash");
  });

  it("includes guest orders placed with the verified e-mail, and is null for an unknown user", async () => {
    const guest = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }], { form: { email: "Asha@example.com" } });
    const data = await exportCustomerData(db(), "cust-a");
    expect(data?.orders.map((o) => o.ref)).toEqual([guest.order.ref]);
    expect(await exportCustomerData(db(), "ghost")).toBeNull();
  });
});

describe("delete my account", () => {
  it("removes the login and personal records, keeps orders unlinked, and writes an audit row", async () => {
    const placed = await populate("cust-a", "asha@example.com");
    const other = await populate("cust-b", "bela@example.com");

    const res = await deleteCustomerAccount(db(), "cust-a", { actor: { id: "cust-a", ip: "203.0.113.9" } });
    expect(res).toEqual({ ok: true, ordersRetained: 1 });

    // gone
    expect(await db().select().from(user).where(eq(user.id, "cust-a"))).toHaveLength(0);
    expect(await db().select().from(session).where(eq(session.userId, "cust-a"))).toHaveLength(0);
    expect(await db().select().from(account).where(eq(account.userId, "cust-a"))).toHaveLength(0);
    expect(await db().select().from(customerProfiles).where(eq(customerProfiles.userId, "cust-a"))).toHaveLength(0);
    expect(await db().select().from(addresses).where(eq(addresses.userId, "cust-a"))).toHaveLength(0);
    expect(await db().select().from(wishlistItems).where(eq(wishlistItems.userId, "cust-a"))).toHaveLength(0);
    expect(await db().select().from(carts).where(eq(carts.userId, "cust-a"))).toHaveLength(0);
    expect(await db().select().from(verification).where(eq(verification.id, "v-cust-a"))).toHaveLength(0);

    // kept: the order (unlinked, with its checkout snapshot), its lines and the support case
    const [order] = await db().select().from(orders).where(eq(orders.id, placed.order.orderId));
    expect(order).toMatchObject({ userId: null, email: "asha@example.com" });
    expect(order!.shippingAddress).toMatchObject({ line1: "12 Marine Drive" });
    expect(await db().select().from(orderItems).where(eq(orderItems.orderId, placed.order.orderId))).toHaveLength(1);
    expect(await db().select().from(supportCases).where(eq(supportCases.orderId, placed.order.orderId))).toHaveLength(1);

    // the other customer is untouched
    expect(await db().select().from(user).where(eq(user.id, "cust-b"))).toHaveLength(1);
    expect(await db().select().from(addresses).where(eq(addresses.userId, "cust-b"))).toHaveLength(1);
    expect(await db().select().from(wishlistItems).where(eq(wishlistItems.userId, "cust-b"))).toHaveLength(1);
    expect((await db().select().from(orders).where(eq(orders.id, other.order.orderId)))[0]!.userId).toBe("cust-b");

    // audit: counts only, no e-mail
    const [audit] = await db().select().from(adminAuditLog).where(eq(adminAuditLog.action, "customer.delete"));
    expect(audit).toMatchObject({ entity: "user", entityId: "cust-a", ip: "203.0.113.9" });
    expect(audit!.diff).toMatchObject({ by: "customer", addresses: 1, wishlistItems: 1, sessions: 1, ordersRetained: 1 });
    expect(JSON.stringify(audit)).not.toContain("asha@example.com");

    // idempotent-ish: a second call finds nothing
    expect(await deleteCustomerAccount(db(), "cust-a", { actor: { id: "cust-a" } })).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it("records a staff actor as 'staff' (the admin Customers module reuses this)", async () => {
    await populate("cust-a", "asha@example.com");
    const res = await deleteCustomerAccount(db(), "cust-a", { actor: { id: "admin-1" } });
    expect(res.ok).toBe(true);
    const [audit] = await db().select().from(adminAuditLog).where(eq(adminAuditLog.action, "customer.delete"));
    expect(audit).toMatchObject({ actorId: "admin-1" });
    expect(audit!.diff).toMatchObject({ by: "staff" });
  });

  it("refuses to delete an admin-role user through the customer flow", async () => {
    const res = await deleteCustomerAccount(db(), "admin-1", { actor: { id: "admin-1" } });
    expect(res).toMatchObject({ ok: false, code: "not_a_customer" });
    expect(await db().select().from(user).where(eq(user.id, "admin-1"))).toHaveLength(1);
  });
});
