import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { couponRedemptions } from "@/server/db/schema";
import type { CartLine } from "@/server/domain";
import {
  confirmRedemption,
  releaseRedemption,
  reserveRedemption,
  validateCoupon,
} from "@/server/services/coupons";
import { loadVariantSnapshots, toCartLine } from "@/server/services/pricing";
import { loadCommerceSettings } from "@/server/services/commerce/settings";

import { makeOrder, seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { configureCommerce, makeCoupon } from "./helpers/factories";

const db = () => getDb();
let f: Fixture;

async function lines(spec: Record<string, number>): Promise<CartLine[]> {
  const keys = Object.keys(spec);
  const snaps = await loadVariantSnapshots(db(), keys.map((k) => f.variants[k]!));
  const settings = await loadCommerceSettings(db());
  return keys.map((k) => toCartLine(snaps.get(f.variants[k]!)!, spec[k]!, settings));
}

async function redeem(couponId: string, email: string, status: "reserved" | "confirmed" | "released") {
  const order = await makeOrder();
  await db().insert(couponRedemptions).values({ couponId, orderId: order.id, email, status });
  return order;
}

beforeEach(async () => {
  f = await seedCatalogFixture();
  await configureCommerce();
});

describe("validateCoupon", () => {
  it("accepts a valid code case-insensitively and reports the discount and eligible lines", async () => {
    await makeCoupon({ code: "Save10", kind: "percent", value: 1000 });
    const cart = await lines({ skull: 1, ghost: 1 }); // 199 + 129
    const r = await validateCoupon(db(), "  sAvE10 ", cart);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.applied.code).toBe("SAVE10");
      expect(r.applied.discountPaise).toBe(3280);
      expect(r.applied.eligibleLineIds).toHaveLength(2);
    }
  });

  it("handles empty, over-long and unknown codes", async () => {
    const cart = await lines({ cat: 1 });
    expect(await validateCoupon(db(), "   ", cart)).toMatchObject({ ok: false, code: "empty" });
    expect(await validateCoupon(db(), "X".repeat(200), cart)).toMatchObject({ ok: false, code: "not_found" });
    const r = await validateCoupon(db(), "ghost", cart);
    expect(r).toEqual({
      ok: false,
      code: "not_found",
      message: "We couldn't find the code GHOST. Check the spelling and try again.",
    });
  });

  it("rejects inactive coupons", async () => {
    await makeCoupon({ code: "OFF", active: false });
    expect(await validateCoupon(db(), "OFF", await lines({ cat: 1 }))).toMatchObject({
      ok: false,
      code: "inactive",
      message: "OFF isn't active right now.",
    });
  });

  it("checks the start and end dates (inclusive), shown in IST", async () => {
    const now = new Date("2026-11-10T06:30:00Z");
    await makeCoupon({ code: "SOON", startsAt: new Date("2026-12-01T00:00:00Z") });
    await makeCoupon({ code: "OLD", endsAt: new Date("2026-11-01T10:00:00Z") });
    await makeCoupon({ code: "NOW", startsAt: now, endsAt: new Date(now.getTime() + 1000) });
    await makeCoupon({ code: "EDGE", startsAt: new Date(now.getTime() - 1000), endsAt: now });
    const cart = await lines({ cat: 1 });
    expect(await validateCoupon(db(), "SOON", cart, null, { now })).toEqual({
      ok: false,
      code: "not_started",
      message: "This code starts on 1 Dec 2026",
    });
    expect(await validateCoupon(db(), "OLD", cart, null, { now })).toEqual({
      ok: false,
      code: "expired",
      message: "This code expired on 1 Nov 2026",
    });
    expect((await validateCoupon(db(), "NOW", cart, null, { now })).ok).toBe(true); // starts at now
    expect((await validateCoupon(db(), "EDGE", cart, null, { now })).ok).toBe(true); // ends at now
  });

  it("enforces the minimum subtotal on the whole cart with the exact message", async () => {
    await makeCoupon({ code: "SAVE10", minSubtotalPaise: 30000 });
    const small = await lines({ cat: 1, ghost: 1 }); // 99 + 129 = 228
    expect(await validateCoupon(db(), "SAVE10", small)).toEqual({
      ok: false,
      code: "min_subtotal",
      message: "Add ₹72 more to use SAVE10",
    });
    expect((await validateCoupon(db(), "SAVE10", await lines({ cat: 1, ghost: 1, skull: 1 }))).ok).toBe(true);
  });

  it("applies scope by vibe, type, product and exclusions", async () => {
    const byVibe = await makeCoupon({ code: "GOTH", scope: { vibes: ["gothic"] } });
    await makeCoupon({ code: "STICK", scope: { types: ["3d-stickers"] } });
    await makeCoupon({ code: "ONLYHEART", scope: { products: [f.products["heart-charm"]!] } });
    await makeCoupon({ code: "NOSKULL", scope: { excludeProducts: [f.products["skull-charm"]!] } });

    const cart = await lines({ skull: 1, cat: 1, heartPink: 1 });
    const vibe = await validateCoupon(db(), "GOTH", cart);
    expect(vibe.ok && vibe.applied.couponId).toBe(byVibe.id);
    // skull is gothic; cat (cute) and heart (cute) are not
    expect(vibe.ok && vibe.applied.eligibleLineIds).toEqual([f.variants.skull]);

    const type = await validateCoupon(db(), "STICK", cart);
    expect(type.ok && type.applied.eligibleLineIds).toEqual([f.variants.cat]);

    const product = await validateCoupon(db(), "ONLYHEART", cart);
    expect(product.ok && product.applied.eligibleLineIds).toEqual([f.variants.heartPink]);

    const excl = await validateCoupon(db(), "NOSKULL", cart);
    expect(excl.ok && excl.applied.eligibleLineIds.sort()).toEqual(
      [f.variants.cat, f.variants.heartPink].sort(),
    );

    expect(await validateCoupon(db(), "GOTH", await lines({ cat: 1 }))).toEqual({
      ok: false,
      code: "no_eligible_items",
      message: "This code doesn't apply to the items in your cart.",
    });
    expect(await validateCoupon(db(), "NOSKULL", await lines({ skull: 1 }))).toMatchObject({
      ok: false,
      code: "no_eligible_items",
    });
  });

  it("counts reserved and confirmed redemptions against the total limit, not released ones", async () => {
    const c = await makeCoupon({ code: "TWICE", usageLimit: 2 });
    const cart = await lines({ cat: 1 });
    await redeem(c.id, "a@example.com", "released");
    expect((await validateCoupon(db(), "TWICE", cart)).ok).toBe(true);
    await redeem(c.id, "b@example.com", "reserved");
    expect((await validateCoupon(db(), "TWICE", cart)).ok).toBe(true);
    await redeem(c.id, "c@example.com", "confirmed");
    expect(await validateCoupon(db(), "TWICE", cart)).toEqual({
      ok: false,
      code: "usage_exhausted",
      message: "This code has been fully claimed.",
    });
  });

  it("enforces the per-email limit case-insensitively, and only when an email is known", async () => {
    const c = await makeCoupon({ code: "ONCE", perCustomerLimit: 1 });
    const cart = await lines({ cat: 1 });
    await redeem(c.id, "Buyer@Example.com", "reserved");
    expect(await validateCoupon(db(), "ONCE", cart, "buyer@example.COM")).toEqual({
      ok: false,
      code: "per_customer_exhausted",
      message: "This code has already been used with your email.",
    });
    expect((await validateCoupon(db(), "ONCE", cart, "other@example.com")).ok).toBe(true);
    // no email yet (cart page): cannot be checked
    expect((await validateCoupon(db(), "ONCE", cart)).ok).toBe(true);
    // a released redemption frees it
    await db().update(couponRedemptions).set({ status: "released" }).where(eq(couponRedemptions.couponId, c.id));
    expect((await validateCoupon(db(), "ONCE", cart, "buyer@example.com")).ok).toBe(true);
  });

  it("does not stack a different code, but re-applying the same one is fine", async () => {
    await makeCoupon({ code: "AAA" });
    await makeCoupon({ code: "BBB" });
    const cart = await lines({ cat: 1 });
    expect((await validateCoupon(db(), "AAA", cart, null, { alreadyAppliedCode: "AAA" })).ok).toBe(true);
    expect(await validateCoupon(db(), "BBB", cart, null, { alreadyAppliedCode: "aaa" })).toEqual({
      ok: false,
      code: "stacking",
      message: "Only one code can be used per order. Remove AAA to use BBB.",
    });
  });

  it("supports fixed and free-shipping coupons", async () => {
    await makeCoupon({ code: "FLAT50", kind: "fixed", value: 5000 });
    await makeCoupon({ code: "SHIPFREE", kind: "free_shipping", value: 0 });
    const cart = await lines({ cat: 1 });
    const flat = await validateCoupon(db(), "FLAT50", cart);
    expect(flat.ok && flat.applied.discountPaise).toBe(5000);
    const ship = await validateCoupon(db(), "SHIPFREE", cart);
    expect(ship.ok && ship.applied).toMatchObject({ kind: "free_shipping", discountPaise: 0 });
  });
});

describe("redemption lifecycle", () => {
  it("reserves (idempotently), confirms and releases", async () => {
    const c = await makeCoupon({ code: "LIFE" });
    const order = await makeOrder();
    const status = async () =>
      (await db().select().from(couponRedemptions).where(eq(couponRedemptions.orderId, order.id))).map(
        (r) => r.status,
      );

    await reserveRedemption(db(), { couponId: c.id, orderId: order.id, email: "x@example.com" });
    await reserveRedemption(db(), { couponId: c.id, orderId: order.id, email: "x@example.com" });
    expect(await status()).toEqual(["reserved"]);

    expect(await confirmRedemption(db(), order.id)).toBe(1);
    expect(await confirmRedemption(db(), order.id)).toBe(0);
    expect(await status()).toEqual(["confirmed"]);

    expect(await releaseRedemption(db(), order.id)).toBe(1); // cancellation of a confirmed one
    expect(await releaseRedemption(db(), order.id)).toBe(0);
    expect(await status()).toEqual(["released"]);
  });
});
