import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { cartItems, carts, orders, user, variants } from "@/server/db/schema";
import {
  addItem,
  applyCoupon,
  clearCart,
  deleteExpiredCarts,
  findCartByToken,
  getCartItemCount,
  getCartView,
  getCartViewByToken,
  getOrCreateCart,
  mergeCarts,
  removeCoupon,
  removeItem,
  setQuantity,
} from "@/server/services/cart";

import { makeOrder, reserve, seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { configureCommerce, makeCart, makeCoupon, seedCommerceReference } from "./helpers/factories";

const db = () => getDb();
let f: Fixture;

beforeEach(async () => {
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
});

async function itemsOf(cartId: string) {
  const rows = await db().select().from(cartItems).where(eq(cartItems.cartId, cartId));
  return Object.fromEntries(rows.map((r) => [r.variantId, r.qty]));
}
async function versionOf(cartId: string) {
  const [row] = await db().select({ v: carts.version }).from(carts).where(eq(carts.id, cartId));
  return row!.v;
}
async function makeUser(id: string) {
  await db().insert(user).values({ id, name: id, email: `${id}@example.com` });
  return id;
}

describe("getOrCreateCart", () => {
  it("creates a cart with a server-minted token and reuses it by token", async () => {
    const first = await getOrCreateCart(db(), null);
    expect(first.created).toBe(true);
    expect(first.cart.token).toMatch(/^[A-Za-z0-9_-]{20,64}$/);
    expect(first.cart.version).toBe(1);
    const again = await getOrCreateCart(db(), first.cart.token);
    expect(again.created).toBe(false);
    expect(again.cart.id).toBe(first.cart.id);
  });

  it("never adopts an unknown client-supplied token", async () => {
    const fake = "A".repeat(32);
    const { cart, created } = await getOrCreateCart(db(), fake);
    expect(created).toBe(true);
    expect(cart.token).not.toBe(fake);
    expect(await findCartByToken(db(), "short")).toBeNull();
    expect(await findCartByToken(db(), "not a token!!not a token!!")).toBeNull();
  });

  it("gives a logged-in visitor their existing cart, and claims an ownerless cart", async () => {
    const uid = await makeUser("u1");
    const owned = await makeCart([{ variantId: f.variants.cat!, qty: 1 }], { userId: uid });
    const { cart } = await getOrCreateCart(db(), null, uid);
    expect(cart.id).toBe(owned.id);

    const guest = await makeCart();
    const claimed = await getOrCreateCart(db(), guest.token, await makeUser("u2"));
    expect(claimed.cart.id).toBe(guest.id);
    expect(claimed.cart.userId).toBe("u2");
  });
});

describe("addItem / setQuantity / removeItem", () => {
  it("adds, accumulates, sets and removes lines, bumping the version each time", async () => {
    const cart = await makeCart();
    expect(await addItem(db(), cart.id, { variantId: f.variants.skull!, qty: 2 })).toEqual({
      ok: true,
      notices: [],
    });
    await addItem(db(), cart.id, { variantId: f.variants.skull!, qty: 3 });
    expect(await itemsOf(cart.id)).toEqual({ [f.variants.skull!]: 5 });
    expect(await versionOf(cart.id)).toBe(3);

    await setQuantity(db(), cart.id, { variantId: f.variants.skull!, qty: 1 });
    expect(await itemsOf(cart.id)).toEqual({ [f.variants.skull!]: 1 });
    await setQuantity(db(), cart.id, { variantId: f.variants.skull!, qty: 0 });
    expect(await itemsOf(cart.id)).toEqual({});

    await addItem(db(), cart.id, { variantId: f.variants.cat!, qty: 1 });
    await removeItem(db(), cart.id, { variantId: f.variants.cat! });
    expect(await itemsOf(cart.id)).toEqual({});
    expect(await versionOf(cart.id)).toBe(7);
  });

  it("caps the quantity at available stock and says so", async () => {
    const cart = await makeCart();
    const r = await addItem(db(), cart.id, { variantId: f.variants.cat!, qty: 5 }); // 3 in stock
    expect(r).toMatchObject({ ok: true, notices: [{ code: "qty_reduced" }] });
    expect(r.ok && r.notices[0]!.message).toBe("Only 3 left of Cat Sticker — we updated your quantity.");
    expect(await itemsOf(cart.id)).toEqual({ [f.variants.cat!]: 3 });
    // already at the cap: adding more keeps 3
    const again = await addItem(db(), cart.id, { variantId: f.variants.cat!, qty: 1 });
    expect(again.ok && again.notices).toHaveLength(1);
    expect(await itemsOf(cart.id)).toEqual({ [f.variants.cat!]: 3 });
  });

  it("subtracts live reservations from what can be added", async () => {
    await reserve(f.variants.cat!, 2, 10);
    const cart = await makeCart();
    const r = await addItem(db(), cart.id, { variantId: f.variants.cat!, qty: 3 });
    expect(r.ok && r.notices[0]!.message).toContain("Only 1 left");
    expect(await itemsOf(cart.id)).toEqual({ [f.variants.cat!]: 1 });
  });

  it("caps at max_qty_per_line when stock is plentiful", async () => {
    await configureCommerce({ max_qty_per_line: 4 });
    const cart = await makeCart();
    const r = await addItem(db(), cart.id, { variantId: f.variants.ghost!, qty: 9 }); // 20 in stock
    expect(r).toMatchObject({ ok: true, notices: [{ code: "max_per_line" }] });
    expect(r.ok && r.notices[0]!.message).toContain("up to 4 of Ghost Sticker");
    expect(await itemsOf(cart.id)).toEqual({ [f.variants.ghost!]: 4 });
  });

  it("rejects sold-out, inactive, draft, unknown and invalid-quantity requests", async () => {
    const cart = await makeCart();
    expect(await addItem(db(), cart.id, { variantId: f.variants.heartRed!, qty: 1 })).toMatchObject({
      ok: false,
      code: "sold_out",
    });
    expect(await addItem(db(), cart.id, { variantId: f.variants.inactiveOnly!, qty: 1 })).toMatchObject({
      ok: false,
      code: "unavailable",
    });
    expect(await addItem(db(), cart.id, { variantId: f.variants.draft!, qty: 1 })).toMatchObject({
      ok: false,
      code: "unavailable",
    });
    expect(
      await addItem(db(), cart.id, { variantId: "00000000-0000-4000-8000-000000000000", qty: 1 }),
    ).toMatchObject({ ok: false, code: "unavailable" });
    for (const qty of [0, -1, 1.5, 1000, Number.NaN]) {
      expect(await addItem(db(), cart.id, { variantId: f.variants.cat!, qty })).toMatchObject({
        ok: false,
        code: "invalid_qty",
      });
    }
    expect(await itemsOf(cart.id)).toEqual({});
  });

  it("returns cart_not_found for a missing cart", async () => {
    expect(
      await addItem(db(), "00000000-0000-4000-8000-000000000000", { variantId: f.variants.cat!, qty: 1 }),
    ).toMatchObject({ ok: false, code: "cart_not_found" });
  });
});

describe("getCartView", () => {
  it("prices the cart with the shared pricing function", async () => {
    const cart = await makeCart([
      { variantId: f.variants.skull!, qty: 2 }, // 2 x 199 = 398
      { variantId: f.variants.cat!, qty: 1 }, // 99
    ]);
    const view = await getCartView(db(), cart.id);
    expect(view.itemCount).toBe(3);
    expect(view.pricing).toMatchObject({
      subtotalPaise: 49700,
      discountPaise: 0,
      shippingPaise: 5000, // below the 500 threshold
      totalPaise: 54700,
      freeShippingRemainingPaise: 300,
      savingsVsMrpPaise: 10000, // (249 - 199) x 2
      freeThresholdPaise: 50000,
    });
    expect(view.pricing.messages).toEqual(["Add ₹3 more for free shipping"]);
    const skull = view.lines.find((l) => l.variantId === f.variants.skull)!;
    expect(skull).toMatchObject({
      productName: "Skull Charm",
      qty: 2,
      unitPricePaise: 19900,
      mrpPaise: 24900,
      lineSubtotalPaise: 39800,
      lineTotalPaise: 39800,
      available: 10,
      maxQty: 10,
    });
    expect(skull.image?.url).toContain("/placeholders/cutouts/skull-photo.svg");
    expect(view.canCheckout).toBe(true);
    expect(view.notices).toEqual([]);
    // GST is contained in the total: skull 3% on 398, cat at the 18% default on 99, shipping at dominant rate
    expect(view.pricing.taxIncludedPaise).toBeGreaterThan(0);
  });

  it("gives free shipping at the threshold", async () => {
    const cart = await makeCart([{ variantId: f.variants.spiky!, qty: 2 }]); // 498 < 500
    expect((await getCartView(db(), cart.id)).pricing.shippingPaise).toBe(5000);
    const bigger = await makeCart([{ variantId: f.variants.ghost!, qty: 4 }]); // 516
    const v = await getCartView(db(), bigger.id);
    expect(v.pricing.shippingPaise).toBe(0);
    expect(v.pricing.freeShippingRemainingPaise).toBe(0);
    expect(v.pricing.messages).toEqual(["You've unlocked free shipping."]);
  });

  it("re-validates: caps the quantity, says so once, and persists the fix", async () => {
    const cart = await makeCart([{ variantId: f.variants.cat!, qty: 3 }]);
    await db().update(variants).set({ stockOnHand: 2 }).where(eq(variants.id, f.variants.cat!));
    const before = await versionOf(cart.id);

    const view = await getCartView(db(), cart.id);
    expect(view.lines[0]!.qty).toBe(2);
    expect(view.notices).toEqual([
      {
        code: "qty_reduced",
        variantId: f.variants.cat,
        message: "Only 2 left of Cat Sticker — we updated your quantity.",
      },
    ]);
    expect(await itemsOf(cart.id)).toEqual({ [f.variants.cat!]: 2 });
    expect(view.version).toBe(before + 1);
    expect(view.pricing.subtotalPaise).toBe(19800);

    const second = await getCartView(db(), cart.id);
    expect(second.notices).toEqual([]);
    expect(second.version).toBe(view.version);
  });

  it("can describe without persisting (sync: false)", async () => {
    const cart = await makeCart([{ variantId: f.variants.cat!, qty: 3 }]);
    await db().update(variants).set({ stockOnHand: 1 }).where(eq(variants.id, f.variants.cat!));
    const view = await getCartView(db(), cart.id, { sync: false });
    expect(view.lines[0]!.qty).toBe(1);
    expect(view.notices).toHaveLength(1);
    expect(await itemsOf(cart.id)).toEqual({ [f.variants.cat!]: 3 });
  });

  it("removes lines whose variant went inactive or whose product was archived", async () => {
    const cart = await makeCart([
      { variantId: f.variants.cat!, qty: 1 },
      { variantId: f.variants.ghost!, qty: 1 },
    ]);
    await db().update(variants).set({ active: false }).where(eq(variants.id, f.variants.cat!));
    const view = await getCartView(db(), cart.id);
    expect(view.lines.map((l) => l.variantId)).toEqual([f.variants.ghost]);
    expect(view.notices).toEqual([
      {
        code: "removed_unavailable",
        variantId: f.variants.cat,
        message: "Cat Sticker is no longer available, so we removed it from your bag.",
      },
    ]);
    expect(await itemsOf(cart.id)).toEqual({ [f.variants.ghost!]: 1 });
  });

  it("removes sold-out lines (reservations count) and flags an empty cart as not checkout-able", async () => {
    const cart = await makeCart([{ variantId: f.variants.cat!, qty: 1 }]);
    await reserve(f.variants.cat!, 3, 10); // everything reserved by someone else
    const view = await getCartView(db(), cart.id);
    expect(view.lines).toEqual([]);
    expect(view.notices[0]).toMatchObject({ code: "removed_sold_out" });
    expect(view.notices[0]!.message).toBe("Cat Sticker just sold out, so we removed it from your bag.");
    expect(view.canCheckout).toBe(false);
    expect(view.pricing.totalPaise).toBe(0);
  });

  it("an expired reservation no longer blocks the cart", async () => {
    await reserve(f.variants.cat!, 3, -5);
    const cart = await makeCart([{ variantId: f.variants.cat!, qty: 3 }]);
    const view = await getCartView(db(), cart.id);
    expect(view.lines[0]!.qty).toBe(3);
    expect(view.notices).toEqual([]);
  });

  it("an empty / unknown token is an empty view, not an error", async () => {
    const empty = await getCartViewByToken(db(), undefined);
    expect(empty).toMatchObject({ cartId: null, itemCount: 0, canCheckout: false, lines: [] });
    expect(await getCartViewByToken(db(), "x".repeat(32))).toMatchObject({ cartId: null });
    const cart = await makeCart();
    expect(await getCartViewByToken(db(), cart.token)).toMatchObject({ cartId: cart.id, lines: [] });
  });

  it("counts items cheaply", async () => {
    const cart = await makeCart([
      { variantId: f.variants.cat!, qty: 2 },
      { variantId: f.variants.ghost!, qty: 1 },
    ]);
    expect(await getCartItemCount(db(), cart.id)).toBe(3);
    expect(await getCartItemCount(db(), (await makeCart()).id)).toBe(0);
  });
});

describe("coupons on the cart", () => {
  it("applies a valid code, prices the discount, and removes it", async () => {
    await makeCoupon({ code: "SAVE10", kind: "percent", value: 1000 });
    const cart = await makeCart([{ variantId: f.variants.ghost!, qty: 2 }]); // 258
    expect(await applyCoupon(db(), cart.id, " save10 ")).toEqual({ ok: true, notices: [] });
    const view = await getCartView(db(), cart.id);
    expect(view.coupon).toEqual({ code: "SAVE10", applied: true, message: null });
    expect(view.pricing.discountPaise).toBe(2580);
    expect(view.lines[0]!.discountAllocPaise).toBe(2580);

    await removeCoupon(db(), cart.id);
    const after = await getCartView(db(), cart.id);
    expect(after.coupon).toBeNull();
    expect(after.pricing.discountPaise).toBe(0);
  });

  it("reports why a code cannot be applied", async () => {
    await makeCoupon({ code: "SAVE10", minSubtotalPaise: 30000 });
    const cart = await makeCart([{ variantId: f.variants.ghost!, qty: 1 }]); // 129
    expect(await applyCoupon(db(), cart.id, "SAVE10")).toMatchObject({
      ok: false,
      code: "coupon",
      couponCode: "min_subtotal",
      message: "Add ₹171 more to use SAVE10",
    });
    expect(await applyCoupon(db(), cart.id, "NOPE")).toMatchObject({ ok: false, couponCode: "not_found" });
    expect((await findCartByToken(db(), cart.token))!.couponCode).toBeNull();
    const emptyCart = await makeCart();
    expect(await applyCoupon(db(), emptyCart.id, "SAVE10")).toMatchObject({ ok: false, code: "coupon" });
  });

  it("does not stack: a second different code is rejected, the same code is fine", async () => {
    await makeCoupon({ code: "ONE" });
    await makeCoupon({ code: "TWO" });
    const cart = await makeCart([{ variantId: f.variants.ghost!, qty: 1 }]);
    expect((await applyCoupon(db(), cart.id, "ONE")).ok).toBe(true);
    expect((await applyCoupon(db(), cart.id, "one")).ok).toBe(true);
    expect(await applyCoupon(db(), cart.id, "TWO")).toMatchObject({
      ok: false,
      couponCode: "stacking",
      message: "Only one code can be used per order. Remove ONE to use TWO.",
    });
  });

  it("keeps a code that only needs more items, but drops one that is no longer valid", async () => {
    await makeCoupon({ code: "BIG", minSubtotalPaise: 30000 });
    const cart = await makeCart([{ variantId: f.variants.ghost!, qty: 1 }], { couponCode: "BIG" });
    const view = await getCartView(db(), cart.id);
    expect(view.coupon).toEqual({ code: "BIG", applied: false, message: "Add ₹171 more to use BIG" });
    expect(view.pricing.discountPaise).toBe(0);
    expect((await findCartByToken(db(), cart.token))!.couponCode).toBe("BIG");

    const gone = await makeCart([{ variantId: f.variants.ghost!, qty: 1 }], { couponCode: "DELETED" });
    const v2 = await getCartView(db(), gone.id);
    expect(v2.coupon).toBeNull();
    expect(v2.notices[0]).toMatchObject({ code: "coupon_removed" });
    expect((await findCartByToken(db(), gone.token))!.couponCode).toBeNull();
  });
});

describe("clearCart / deleteExpiredCarts", () => {
  it("empties the cart and its coupon", async () => {
    const cart = await makeCart([{ variantId: f.variants.cat!, qty: 1 }], { couponCode: "X" });
    await clearCart(db(), cart.id);
    expect(await itemsOf(cart.id)).toEqual({});
    expect((await findCartByToken(db(), cart.token))!.couponCode).toBeNull();
  });

  it("deletes only expired carts", async () => {
    const live = await makeCart();
    const old = await makeCart();
    await db()
      .update(carts)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(carts.id, old.id));
    expect(await deleteExpiredCarts(db())).toBe(1);
    expect(await findCartByToken(db(), old.token)).toBeNull();
    expect(await findCartByToken(db(), live.token)).not.toBeNull();
  });
});

describe("mergeCarts", () => {
  it("claims the guest cart when the user has none", async () => {
    const uid = await makeUser("m1");
    const guest = await makeCart([{ variantId: f.variants.cat!, qty: 1 }]);
    const r = await mergeCarts(db(), guest.token, uid);
    expect(r).toEqual({ token: guest.token, merged: true, notices: [] });
    expect((await findCartByToken(db(), guest.token))!.userId).toBe(uid);
  });

  it("adds quantities, caps by stock, carries the coupon, and deletes the guest cart", async () => {
    const uid = await makeUser("m2");
    const mine = await makeCart(
      [
        { variantId: f.variants.cat!, qty: 2 },
        { variantId: f.variants.ghost!, qty: 1 },
      ],
      { userId: uid },
    );
    const guest = await makeCart(
      [
        { variantId: f.variants.cat!, qty: 2 }, // 2 + 2 > 3 in stock
        { variantId: f.variants.skull!, qty: 1 },
        { variantId: f.variants.inactiveOnly!, qty: 1 }, // not purchasable: skipped
      ],
      { couponCode: "WELCOME" },
    );
    const order = await makeOrder();
    await db().update(orders).set({ cartId: guest.id }).where(eq(orders.id, order.id));
    const before = await versionOf(mine.id);

    const r = await mergeCarts(db(), guest.token, uid);
    expect(r.token).toBe(mine.token);
    expect(r.merged).toBe(true);
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0]).toMatchObject({ code: "merged_reduced", variantId: f.variants.cat });

    expect(await itemsOf(mine.id)).toEqual({
      [f.variants.cat!]: 3,
      [f.variants.ghost!]: 1,
      [f.variants.skull!]: 1,
    });
    const merged = await findCartByToken(db(), mine.token);
    expect(merged!.couponCode).toBe("WELCOME");
    expect(merged!.version).toBe(before + 1);
    expect(await findCartByToken(db(), guest.token)).toBeNull();
    const [o] = await db().select({ cartId: orders.cartId }).from(orders).where(eq(orders.id, order.id));
    expect(o!.cartId).toBe(mine.id);
  });

  it("keeps the user's own coupon, and is a no-op without a guest cart or for someone else's cart", async () => {
    const uid = await makeUser("m3");
    const other = await makeUser("m4");
    const mine = await makeCart([{ variantId: f.variants.ghost!, qty: 1 }], { userId: uid, couponCode: "MINE" });
    const guest = await makeCart([{ variantId: f.variants.cat!, qty: 1 }], { couponCode: "THEIRS" });
    await mergeCarts(db(), guest.token, uid);
    expect((await findCartByToken(db(), mine.token))!.couponCode).toBe("MINE");

    expect(await mergeCarts(db(), undefined, uid)).toEqual({ token: mine.token, merged: false, notices: [] });
    const theirs = await makeCart([], { userId: other });
    expect(await mergeCarts(db(), theirs.token, uid)).toMatchObject({ merged: false });
    expect(await findCartByToken(db(), theirs.token)).not.toBeNull();
    // already the user's own cart
    expect(await mergeCarts(db(), mine.token, uid)).toEqual({ token: mine.token, merged: false, notices: [] });
  });
});
