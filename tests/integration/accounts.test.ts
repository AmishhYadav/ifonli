import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { upsertAdminUser } from "@/server/auth/admin-user";
import { getAuth } from "@/server/auth/auth";
import { getDb } from "@/server/db";
import {
  addresses,
  adminAuditLog,
  carts,
  customerProfiles,
  orders,
  session,
  user,
  verification,
  wishlistItems,
} from "@/server/db/schema";
import {
  createAddress,
  deleteAddress,
  deleteCustomerAccount,
  exportCustomerData,
  getAccountWishlist,
  getCustomerProfile,
  getDefaultAddress,
  listAddresses,
  listCustomerOrders,
  replaceAccountWishlist,
  setDefaultAddress,
  updateAddress,
  updateCustomerProfile,
} from "@/server/services/accounts";
import { findCartByToken } from "@/server/services/cart";
import { getOrderForCustomer, getOrderForUser } from "@/server/services/orders";
import { attachGuestOrders, completeCustomerSignIn } from "@/server/services/sign-in";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import {
  placeCodOrder,
  configureCommerce,
  makeCart,
  seedCommerceReference,
} from "./helpers/factories";

process.env.BETTER_AUTH_SECRET ||= "integration-test-secret-integration-test-secret";

const db = () => getDb();
let f: Fixture;

beforeEach(async () => {
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
});

afterEach(() => vi.restoreAllMocks());

let seq = 0;
async function makeUser(
  email = `shopper${++seq}@example.com`,
  overrides: Partial<typeof user.$inferInsert> = {},
) {
  const [row] = await db()
    .insert(user)
    .values({
      id: `u-${seq}-${Math.random().toString(36).slice(2, 8)}`,
      name: "",
      email,
      emailVerified: true,
      ...overrides,
    })
    .returning();
  return row!;
}

const addr = (over: Record<string, unknown> = {}) => ({
  name: "Asha Rao",
  phone: "+919876543210",
  line1: "12 Marine Drive",
  city: "Mumbai",
  state: "Maharashtra",
  pincode: "400001",
  ...over,
});

async function expectOk<T extends { ok: boolean }>(
  promise: Promise<T>,
): Promise<Extract<T, { ok: true }>> {
  const r = await promise;
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
}

describe("addresses", () => {
  it("makes the first address the default and keeps exactly one default", async () => {
    const u = await makeUser();
    const a = (await expectOk(createAddress(db(), u.id, addr()))).address;
    expect(a.isDefault).toBe(true);

    const b = (await expectOk(createAddress(db(), u.id, addr({ line1: "5 Park Street" })))).address;
    expect(b.isDefault).toBe(false);

    const c = (
      await expectOk(createAddress(db(), u.id, addr({ line1: "9 Hill Road", isDefault: true })))
    ).address;
    expect(c.isDefault).toBe(true);

    let list = await listAddresses(db(), u.id);
    expect(list.filter((x) => x.isDefault).map((x) => x.id)).toEqual([c.id]);
    expect(list[0]!.id).toBe(c.id); // default first

    await expectOk(setDefaultAddress(db(), u.id, a.id));
    list = await listAddresses(db(), u.id);
    expect(list.filter((x) => x.isDefault).map((x) => x.id)).toEqual([a.id]);
    expect((await getDefaultAddress(db(), u.id))?.id).toBe(a.id);
  });

  it("updates in place, keeps the default flag unless asked, and canonicalises the state", async () => {
    const u = await makeUser();
    const a = (await expectOk(createAddress(db(), u.id, addr()))).address;
    const b = (await expectOk(createAddress(db(), u.id, addr({ line1: "5 Park Street" })))).address;

    const edited = (
      await expectOk(
        updateAddress(db(), u.id, a.id, addr({ line1: "99 New Road", state: "maharashtra" })),
      )
    ).address;
    expect(edited.line1).toBe("99 New Road");
    expect(edited.state).toBe("Maharashtra");
    expect(edited.isDefault).toBe(true); // an edit without isDefault keeps it

    await expectOk(
      updateAddress(db(), u.id, b.id, addr({ line1: "5 Park Street", isDefault: true })),
    );
    const list = await listAddresses(db(), u.id);
    expect(list.filter((x) => x.isDefault).map((x) => x.id)).toEqual([b.id]);
  });

  it("promotes another address when the default is deleted, and empties cleanly", async () => {
    const u = await makeUser();
    const a = (await expectOk(createAddress(db(), u.id, addr()))).address;
    const b = (await expectOk(createAddress(db(), u.id, addr({ line1: "5 Park Street" })))).address;
    expect(await deleteAddress(db(), u.id, a.id)).toBe(true);
    const list = await listAddresses(db(), u.id);
    expect(list.map((x) => [x.id, x.isDefault])).toEqual([[b.id, true]]);
    expect(await deleteAddress(db(), u.id, b.id)).toBe(true);
    expect(await listAddresses(db(), u.id)).toEqual([]);
    expect(await deleteAddress(db(), u.id, b.id)).toBe(false);
  });

  it("refuses an unknown state and the eleventh address", async () => {
    const u = await makeUser();
    const bad = await createAddress(db(), u.id, addr({ state: "Atlantis" }));
    expect(bad).toMatchObject({ ok: false, code: "invalid_state" });

    for (let i = 0; i < 10; i++)
      await expectOk(createAddress(db(), u.id, addr({ line1: `${i + 1} Marine Drive` })));
    const over = await createAddress(db(), u.id, addr({ line1: "11 Marine Drive" }));
    expect(over).toMatchObject({ ok: false, code: "limit_reached" });
    expect(await listAddresses(db(), u.id)).toHaveLength(10);
  });

  it("holds the limit and the single default under concurrent adds", async () => {
    const u = await makeUser();
    const results = await Promise.all(
      Array.from({ length: 14 }, (_, i) =>
        createAddress(db(), u.id, addr({ line1: `${i + 1} Race Road`, isDefault: true })),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    const list = await listAddresses(db(), u.id);
    expect(list).toHaveLength(10);
    expect(list.filter((x) => x.isDefault)).toHaveLength(1);
  });

  it("scopes everything to the owner: user A cannot read, edit, default or delete B's address", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const theirs = (await expectOk(createAddress(db(), b.id, addr({ name: "Bela" })))).address;

    expect(await listAddresses(db(), a.id)).toEqual([]);
    expect(await updateAddress(db(), a.id, theirs.id, addr({ name: "Hijacked" }))).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(await setDefaultAddress(db(), a.id, theirs.id)).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(await deleteAddress(db(), a.id, theirs.id)).toBe(false);
    expect(await updateAddress(db(), a.id, "not-a-uuid", addr())).toMatchObject({
      ok: false,
      code: "not_found",
    });

    const [row] = await db().select().from(addresses).where(eq(addresses.id, theirs.id));
    expect(row?.name).toBe("Bela");
    expect(row?.userId).toBe(b.id);
  });

  it("the database refuses two defaults for one user", async () => {
    const u = await makeUser();
    await expectOk(createAddress(db(), u.id, addr()));
    await expect(
      db()
        .insert(addresses)
        .values({ userId: u.id, ...addr({ phone: "+919876543210" }), isDefault: true }),
    ).rejects.toThrow();
  });
});

describe("profile", () => {
  it("saves name, phone and marketing choice, and starts opted out", async () => {
    const u = await makeUser();
    const before = await getCustomerProfile(db(), u.id);
    expect(before).toMatchObject({ name: "", phone: null, marketingOptIn: false });

    await updateCustomerProfile(db(), u.id, {
      name: "Asha Rao",
      phone: "+919876543210",
      marketingOptIn: true,
    });
    expect(await getCustomerProfile(db(), u.id)).toMatchObject({
      name: "Asha Rao",
      phone: "+919876543210",
      marketingOptIn: true,
    });

    await updateCustomerProfile(db(), u.id, { name: "Asha R", phone: null, marketingOptIn: false });
    expect(await getCustomerProfile(db(), u.id)).toMatchObject({
      name: "Asha R",
      phone: null,
      marketingOptIn: false,
    });
  });
});

describe("attachGuestOrders (D-AUTH-2)", () => {
  it("claims only ownerless orders with the same e-mail, case-insensitively, and is idempotent", async () => {
    const owner = await makeUser("buyer@example.com");
    const other = await makeUser("other@example.com");
    const items = [{ variantId: f.variants.skull!, qty: 1 }];

    const mine1 = (await placeCodOrder(items, { form: { email: "Buyer@Example.com" } })).order;
    const mine2 = (await placeCodOrder(items, { form: { email: "buyer@example.com" } })).order;
    const someoneElses = (await placeCodOrder(items, { form: { email: "stranger@example.com" } }))
      .order;
    const alreadyOther = (await placeCodOrder(items, { form: { email: "buyer@example.com" } }))
      .order;
    await db().update(orders).set({ userId: other.id }).where(eq(orders.id, alreadyOther.orderId));

    expect(await attachGuestOrders(db(), owner.id, "buyer@example.com")).toBe(2);
    expect(await attachGuestOrders(db(), owner.id, "buyer@example.com")).toBe(0);

    const owner_of = async (id: string) =>
      (await db().select({ u: orders.userId }).from(orders).where(eq(orders.id, id)))[0]!.u;
    expect(await owner_of(mine1.orderId)).toBe(owner.id);
    expect(await owner_of(mine2.orderId)).toBe(owner.id);
    expect(await owner_of(someoneElses.orderId)).toBeNull();
    expect(await owner_of(alreadyOther.orderId)).toBe(other.id);
  });

  it("does not match a different address that merely contains the e-mail", async () => {
    const owner = await makeUser("buyer@example.com");
    const items = [{ variantId: f.variants.skull!, qty: 1 }];
    const o = (await placeCodOrder(items, { form: { email: "xbuyer@example.com" } })).order;
    expect(await attachGuestOrders(db(), owner.id, "buyer@example.com")).toBe(0);
    const [row] = await db()
      .select({ u: orders.userId })
      .from(orders)
      .where(eq(orders.id, o.orderId));
    expect(row?.u).toBeNull();
  });
});

describe("completeCustomerSignIn", () => {
  it("claims the guest cart when the customer has none, and attaches orders", async () => {
    const u = await makeUser("buyer@example.com");
    const guest = await makeCart([{ variantId: f.variants.skull!, qty: 2 }]);
    await placeCodOrder([{ variantId: f.variants.cat!, qty: 1 }], {
      form: { email: "buyer@example.com" },
    });

    const out = await completeCustomerSignIn(db(), {
      userId: u.id,
      email: u.email,
      guestCartToken: guest.token,
    });
    expect(out.cartToken).toBe(guest.token);
    expect(out.cart.merged).toBe(true);
    expect(out.attachedOrders).toBe(1);
    expect((await findCartByToken(db(), guest.token))?.userId).toBe(u.id);

    // Idempotent: a second run (same cookie) changes nothing.
    const again = await completeCustomerSignIn(db(), {
      userId: u.id,
      email: u.email,
      guestCartToken: guest.token,
    });
    expect(again.cartToken).toBe(guest.token);
    expect(again.cart.merged).toBe(false);
    expect(again.attachedOrders).toBe(0);
  });

  it("merges the guest cart into the customer's existing cart and switches to its token", async () => {
    const u = await makeUser("buyer@example.com");
    const skull = f.variants.skull!;
    const cat = f.variants.cat!;
    const mine = await makeCart([{ variantId: skull, qty: 1 }], { userId: u.id });
    const guest = await makeCart([
      { variantId: skull, qty: 2 },
      { variantId: cat, qty: 1 },
    ]);

    const out = await completeCustomerSignIn(db(), {
      userId: u.id,
      email: u.email,
      guestCartToken: guest.token,
    });
    expect(out.cartToken).toBe(mine.token);
    expect(out.cart.merged).toBe(true);
    expect(await findCartByToken(db(), guest.token)).toBeNull();

    const view = await import("@/server/services/cart").then((m) => m.getCartView(db(), mine.id));
    const qty = Object.fromEntries(view.lines.map((l) => [l.variantId, l.qty]));
    expect(qty[skull]).toBe(3);
    expect(qty[cat]).toBe(1);
  });

  it("works with no guest cart at all", async () => {
    const u = await makeUser("buyer@example.com");
    const out = await completeCustomerSignIn(db(), {
      userId: u.id,
      email: u.email,
      guestCartToken: null,
    });
    expect(out.cartToken).toBeNull();
    expect(out.attachedOrders).toBe(0);
  });

  it("still returns the customer's own cart token when the guest cookie is stale", async () => {
    const u = await makeUser("buyer@example.com");
    const mine = await makeCart([], { userId: u.id });
    const out = await completeCustomerSignIn(db(), {
      userId: u.id,
      email: u.email,
      guestCartToken: "stale-token-that-does-not-exist-0000",
    });
    expect(out.cartToken).toBe(mine.token);
  });
});

describe("account wishlist (server half of WishlistSync)", () => {
  it("pushes (replaces), pulls, and drops ids that are not products", async () => {
    const u = await makeUser();
    const a = f.products["skull-charm"]!;
    const b = f.products["heart-charm"]!;
    const c = f.products["cat-sticker"]!;
    const ghost = "00000000-0000-4000-8000-000000000999";
    const t = Date.now() - 100_000;

    const stored = await replaceAccountWishlist(db(), u.id, [
      { id: a, addedAt: t },
      { id: b, addedAt: t + 1000 },
      { id: ghost, addedAt: t },
      { id: a, addedAt: t + 5 }, // duplicate
    ]);
    expect(stored.map((e) => e.id).sort()).toEqual([a, b].sort());
    expect((await getAccountWishlist(db(), u.id))[0]!.id).toBe(b); // newest first
    expect((await getAccountWishlist(db(), u.id)).find((e) => e.id === a)!.addedAt).toBe(t);

    // Replace: b removed, c added; a keeps its original save time.
    await replaceAccountWishlist(db(), u.id, [
      { id: a, addedAt: t + 99 },
      { id: c, addedAt: t + 2000 },
    ]);
    const after = await getAccountWishlist(db(), u.id);
    expect(after.map((e) => e.id).sort()).toEqual([a, c].sort());
    expect(after.find((e) => e.id === a)!.addedAt).toBe(t);

    await replaceAccountWishlist(db(), u.id, []);
    expect(await getAccountWishlist(db(), u.id)).toEqual([]);
  });

  it("never touches another customer's list", async () => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const a = f.products["skull-charm"]!;
    await replaceAccountWishlist(db(), u1.id, [{ id: a, addedAt: 1 }]);
    await replaceAccountWishlist(db(), u2.id, []);
    expect(await getAccountWishlist(db(), u1.id)).toHaveLength(1);
  });

  it("merging a device list with the account list is the union (pull + merge + push)", async () => {
    const { mergeWishlists } = await import("@/features/wishlist/list");
    const u = await makeUser();
    const [a, b, c] = [
      f.products["skull-charm"]!,
      f.products["heart-charm"]!,
      f.products["cat-sticker"]!,
    ];
    await replaceAccountWishlist(db(), u.id, [
      { id: a, addedAt: 1000 },
      { id: b, addedAt: 2000 },
    ]);
    const device = [
      { id: b, addedAt: 500 },
      { id: c, addedAt: 3000 },
    ];
    const merged = mergeWishlists(device, await getAccountWishlist(db(), u.id));
    await replaceAccountWishlist(db(), u.id, merged);
    const final = await getAccountWishlist(db(), u.id);
    expect(final.map((e) => e.id).sort()).toEqual([a, b, c].sort());
  });
});

describe("order history and detail", () => {
  it("lists only the customer's own orders, newest first, with pagination", async () => {
    const u = await makeUser("buyer@example.com");
    const other = await makeUser("other@example.com");
    const items = [{ variantId: f.variants.skull!, qty: 1 }];
    const refs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const o = (await placeCodOrder(items, { form: { email: "buyer@example.com" } })).order;
      await db()
        .update(orders)
        .set({ userId: u.id, placedAt: new Date(Date.now() - (3 - i) * 60_000) })
        .where(eq(orders.id, o.orderId));
      refs.push(o.ref);
    }
    const foreign = (await placeCodOrder(items, { form: { email: "other@example.com" } })).order;
    await db().update(orders).set({ userId: other.id }).where(eq(orders.id, foreign.orderId));

    const page1 = await listCustomerOrders(db(), u.id, { page: 1, pageSize: 2 });
    expect(page1.total).toBe(3);
    expect(page1.pageCount).toBe(2);
    expect(page1.orders.map((o) => o.ref)).toEqual([refs[2], refs[1]]);
    expect(page1.orders[0]!.itemNames.length).toBeGreaterThan(0);
    const page2 = await listCustomerOrders(db(), u.id, { page: 2, pageSize: 2 });
    expect(page2.orders.map((o) => o.ref)).toEqual([refs[0]]);
    // Out-of-range pages clamp to the last page.
    expect((await listCustomerOrders(db(), u.id, { page: 99, pageSize: 2 })).page).toBe(2);
    expect(
      (await listCustomerOrders(db(), other.id, { page: 1, pageSize: 10 })).orders.map(
        (o) => o.ref,
      ),
    ).toEqual([foreign.ref]);
  });

  it("the account detail refuses other users' orders and guest orders; guests still need the token", async () => {
    const owner = await makeUser("buyer@example.com");
    const other = await makeUser("other@example.com");
    const placed = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }], {
      form: { email: "buyer@example.com" },
    });
    const { ref, orderId } = placed.order;

    // Still a guest order: nobody owns it, so the account route shows nothing.
    expect(await getOrderForUser(db(), ref, owner.id)).toBeNull();

    await db().update(orders).set({ userId: owner.id }).where(eq(orders.id, orderId));
    const mine = await getOrderForUser(db(), ref.toLowerCase(), owner.id);
    expect(mine?.ref).toBe(ref);
    expect(mine?.hasAccount).toBe(true);
    expect(mine?.items.length).toBe(1);
    expect(await getOrderForUser(db(), ref, other.id)).toBeNull();
    expect(await getOrderForUser(db(), "IFO-NOPE", owner.id)).toBeNull();

    // The token path is unchanged.
    expect(await getOrderForCustomer(db(), ref, "wrong-token")).toBeNull();
    expect((await getOrderForCustomer(db(), ref, placed.token))?.ref).toBe(ref);
  });
});

describe("export", () => {
  it("contains the customer's data and no internal ids or other customers' data", async () => {
    const u = await makeUser("buyer@example.com");
    const other = await makeUser("other@example.com");
    await updateCustomerProfile(db(), u.id, {
      name: "Asha Rao",
      phone: "+919876543210",
      marketingOptIn: true,
    });
    const address = (await expectOk(createAddress(db(), u.id, addr()))).address;
    await expectOk(createAddress(db(), other.id, addr({ name: "Bela Other" })));
    await replaceAccountWishlist(db(), u.id, [
      { id: f.products["skull-charm"]!, addedAt: Date.now() - 1000 },
    ]);
    const mine = (
      await placeCodOrder([{ variantId: f.variants.skull!, qty: 2 }], {
        form: { email: "buyer@example.com" },
      })
    ).order;
    const theirs = (
      await placeCodOrder([{ variantId: f.variants.cat!, qty: 1 }], {
        form: { email: "other@example.com" },
      })
    ).order;
    await db().update(orders).set({ userId: u.id }).where(eq(orders.id, mine.orderId));
    await db().update(orders).set({ userId: other.id }).where(eq(orders.id, theirs.orderId));

    const data = (await exportCustomerData(db(), u.id))!;
    expect(data.account).toMatchObject({ email: "buyer@example.com", name: "Asha Rao" });
    expect(data.profile).toEqual({ phone: "+919876543210", marketingOptIn: true });
    expect(data.addresses).toHaveLength(1);
    expect(data.addresses[0]).toMatchObject({
      name: "Asha Rao",
      pincode: "400001",
      isDefault: true,
    });
    expect(data.orders).toHaveLength(1);
    expect(data.orders[0]).toMatchObject({ reference: mine.ref, totalPaise: mine.totalPaise });
    expect((data.orders[0] as { items: unknown[] }).items).toHaveLength(1);
    expect(data.wishlist).toHaveLength(1);
    expect(data.wishlist[0]).toMatchObject({ productSlug: "skull-charm" });

    const json = JSON.stringify(data);
    for (const secret of [
      u.id,
      other.id,
      address.id,
      mine.orderId,
      theirs.ref,
      "Bela Other",
      "other@example.com",
      f.products["skull-charm"]!,
    ]) {
      expect(json, secret).not.toContain(secret);
    }
    expect(await exportCustomerData(db(), "no-such-user")).toBeNull();
  });
});

describe("delete account (D-AUTH-3)", () => {
  it("removes personal data, keeps orders detached with their e-mail, and anonymises the user", async () => {
    const u = await makeUser("buyer@example.com", {
      name: "Asha Rao",
      image: "https://example.com/me.png",
    });
    const other = await makeUser("other@example.com");
    await updateCustomerProfile(db(), u.id, {
      name: "Asha Rao",
      phone: "+919876543210",
      marketingOptIn: true,
    });
    await expectOk(createAddress(db(), u.id, addr()));
    await expectOk(createAddress(db(), other.id, addr()));
    await replaceAccountWishlist(db(), u.id, [{ id: f.products["skull-charm"]!, addedAt: 5 }]);
    const cart = await makeCart([{ variantId: f.variants.skull!, qty: 1 }], { userId: u.id });
    await db()
      .insert(session)
      .values({
        id: "s1",
        token: "tok-1",
        userId: u.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        updatedAt: new Date(),
      });
    await db()
      .insert(verification)
      .values({
        id: "v1",
        identifier: "sign-in-otp-buyer@example.com",
        value: "123456:0",
        expiresAt: new Date(Date.now() + 60_000),
      });
    const order = (
      await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }], {
        form: { email: "buyer@example.com" },
      })
    ).order;
    await db().update(orders).set({ userId: u.id }).where(eq(orders.id, order.orderId));

    const res = await deleteCustomerAccount(db(), u.id, { ip: "203.0.113.9" });
    expect(res).toEqual({ ok: true, ordersDetached: 1 });

    expect(await db().select().from(addresses).where(eq(addresses.userId, u.id))).toEqual([]);
    expect(await db().select().from(wishlistItems).where(eq(wishlistItems.userId, u.id))).toEqual(
      [],
    );
    expect(await db().select().from(carts).where(eq(carts.id, cart.id))).toEqual([]);
    expect(await db().select().from(session).where(eq(session.userId, u.id))).toEqual([]);
    expect(await db().select().from(verification).where(eq(verification.id, "v1"))).toEqual([]);

    // Order retained for the invoice, detached from the account, e-mail kept.
    const [kept] = await db().select().from(orders).where(eq(orders.id, order.orderId));
    expect(kept?.userId).toBeNull();
    expect(kept?.email).toBe("buyer@example.com");
    expect((kept?.shippingAddress as { line1?: string }).line1).toBe("12 Marine Drive");

    // The user row is a tombstone: no name, e-mail, image; banned.
    const [tomb] = await db().select().from(user).where(eq(user.id, u.id));
    expect(tomb).toMatchObject({
      name: "Deleted customer",
      image: null,
      emailVerified: false,
      banned: true,
    });
    expect(tomb?.email).toBe(`deleted-${u.id}@deleted.invalid`);
    const [profile] = await db()
      .select()
      .from(customerProfiles)
      .where(eq(customerProfiles.userId, u.id));
    expect(profile?.phone).toBeNull();
    expect(profile?.marketingOptIn).toBe(false);
    expect(profile?.deletedAt).toBeInstanceOf(Date);

    // Audit entry, with no personal data.
    const audit = await db()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "customer.account_deleted"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityId: u.id, ip: "203.0.113.9" });
    expect(JSON.stringify(audit[0]!.diff)).not.toContain("buyer@example.com");

    // The other customer is untouched, and the old e-mail can sign up again as a new account.
    expect(await listAddresses(db(), other.id)).toHaveLength(1);
    const reborn = await makeUser("buyer@example.com");
    expect(reborn.id).not.toBe(u.id);
    expect(await attachGuestOrders(db(), reborn.id, "buyer@example.com")).toBe(1);
  });

  it("refuses admin accounts and unknown users", async () => {
    const { userId } = await upsertAdminUser(db(), {
      email: "boss@example.com",
      role: "owner",
      password: "Correct-Horse-Battery-9",
    });
    expect(await deleteCustomerAccount(db(), userId)).toEqual({
      ok: false,
      code: "not_a_customer",
    });
    expect(await deleteCustomerAccount(db(), "nope")).toEqual({ ok: false, code: "not_found" });
    const [still] = await db().select().from(user).where(eq(user.id, userId));
    expect(still?.email).toBe("boss@example.com");
  });
});

describe("email-OTP sign-in", () => {
  async function sendAndRead(email: string): Promise<string> {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    spy.mockClear();
    await getAuth().api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    const line = spy.mock.calls.map((c) => String(c[0])).find((l) => l.includes(email));
    return line?.match(/: (\d{6})$/)?.[1] ?? "";
  }

  it("creates a customer on first verify and lets them back in with a new code", async () => {
    const otp1 = await sendAndRead("new@example.com");
    expect(otp1).toMatch(/^\d{6}$/);
    const first = await getAuth().api.signInEmailOTP({
      body: { email: "new@example.com", otp: otp1 },
    });
    expect(first.user.email).toBe("new@example.com");
    const [row] = await db().select().from(user).where(eq(user.email, "new@example.com"));
    expect(row).toMatchObject({ role: "customer", emailVerified: true });

    const otp2 = await sendAndRead("new@example.com");
    const second = await getAuth().api.signInEmailOTP({
      body: { email: "new@example.com", otp: otp2 },
    });
    expect(second.user.id).toBe(first.user.id);
  });

  it("rejects a wrong code and counts the attempts", async () => {
    const otp = await sendAndRead("new@example.com");
    const wrong = otp === "000000" ? "111111" : "000000";
    await expect(
      getAuth().api.signInEmailOTP({ body: { email: "new@example.com", otp: wrong } }),
    ).rejects.toMatchObject({ body: { code: "INVALID_OTP" } });
    // The right code still works until the attempts run out.
    const ok = await getAuth().api.signInEmailOTP({ body: { email: "new@example.com", otp } });
    expect(ok.user.email).toBe("new@example.com");
  });

  it("burns the code after too many wrong attempts", async () => {
    const otp = await sendAndRead("new@example.com");
    const wrong = otp === "000000" ? "111111" : "000000";
    const codes: string[] = [];
    for (let i = 0; i < 7; i++) {
      try {
        await getAuth().api.signInEmailOTP({ body: { email: "new@example.com", otp: wrong } });
      } catch (e) {
        codes.push((e as { body?: { code?: string } }).body?.code ?? "");
      }
    }
    expect(codes).toContain("TOO_MANY_ATTEMPTS");
    await expect(
      getAuth().api.signInEmailOTP({ body: { email: "new@example.com", otp } }),
    ).rejects.toBeDefined();
  });

  it("still refuses email-OTP for admin accounts (D-AUTH-1)", async () => {
    await upsertAdminUser(db(), {
      email: "boss@example.com",
      role: "owner",
      password: "Correct-Horse-Battery-9",
    });
    await expect(
      getAuth().api.sendVerificationOTP({ body: { email: "boss@example.com", type: "sign-in" } }),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
    await expect(
      getAuth().api.signInEmailOTP({ body: { email: "Boss@Example.com", otp: "123456" } }),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
  });
});
