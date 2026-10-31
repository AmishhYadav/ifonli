import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { formToInput, couponFormSchema, EMPTY_COUPON_FORM, couponToFormValues } from "@/components/admin/discounts/form-values";
import { getDb } from "@/server/db";
import { adminAuditLog, coupons, user } from "@/server/db/schema";
import {
  createCoupon,
  getCoupon,
  listCoupons,
  setCouponActive,
  updateCoupon,
} from "@/server/services/admin/discounts";
import { validateCoupon } from "@/server/services/coupons";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { configureCommerce, placeCodOrder, seedCommerceReference } from "./helpers/factories";

const db = () => getDb();
const owner = { id: "owner-1", role: "owner" };
const admin = { id: "admin-1", role: "admin" };
const fulfilment = { id: "ful-1", role: "fulfilment" };

let f: Fixture;
beforeEach(async () => {
  await db()
    .insert(user)
    .values([
      { id: "owner-1", name: "Owner", email: "owner@example.com", role: "owner" },
      { id: "admin-1", name: "Admin", email: "admin@example.com", role: "admin" },
      { id: "ful-1", name: "Packer", email: "ful@example.com", role: "fulfilment" },
    ]);
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
});

const base = { code: "save10", kind: "percent", value: 1000 };

describe("coupon CRUD", () => {
  it("creates with every rule, normalises the code and audits", async () => {
    const res = await createCoupon(
      db(),
      {
        ...base,
        startsAt: "2026-11-01T00:00:00+05:30",
        endsAt: "2026-12-01T00:00:00+05:30",
        minSubtotalPaise: 50000,
        maxDiscountPaise: 20000,
        usageLimit: 100,
        perCustomerLimit: 2,
        scope: { vibes: ["cute"], types: ["charms"], products: [f.products["skull-charm"]!], excludeProducts: [] },
      },
      admin,
    );
    expect(res.code).toBe("SAVE10");
    const [row] = await db().select().from(coupons).where(eq(coupons.id, res.id));
    expect(row).toMatchObject({
      code: "SAVE10",
      kind: "percent",
      value: 1000,
      minSubtotalPaise: 50000,
      maxDiscountPaise: 20000,
      usageLimit: 100,
      perCustomerLimit: 2,
      stackable: false,
      active: true,
    });
    expect(row!.scope).toMatchObject({ vibes: ["cute"], types: ["charms"] });
    const [log] = await db().select().from(adminAuditLog).where(eq(adminAuditLog.action, "coupon.create"));
    expect(log).toMatchObject({ actorId: "admin-1", entityId: res.id });
  });

  it("rejects duplicate codes regardless of case, with a field error on code", async () => {
    await createCoupon(db(), base, owner);
    const err = await createCoupon(db(), { ...base, code: "Save10" }, owner).catch((e) => e);
    expect(err).toBeInstanceOf(ZodError);
    expect((err as ZodError).issues[0]!.path).toEqual(["code"]);
    expect(await db().select().from(coupons)).toHaveLength(1);
  });

  it("validates values: percent <= 100, fixed > 0, dates ordered, limits, scope", async () => {
    const bad = async (patch: Record<string, unknown>, path: string) => {
      const err = await createCoupon(db(), { ...base, code: `X${Math.random().toString(36).slice(2, 8)}`, ...patch }, owner).catch((e) => e);
      expect(err).toBeInstanceOf(ZodError);
      expect((err as ZodError).issues.map((i) => i.path.join("."))).toContain(path);
    };
    await bad({ value: 10001 }, "value");
    await bad({ value: 0 }, "value");
    await bad({ kind: "fixed", value: 0 }, "value");
    await bad({ startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" }, "endsAt");
    await bad({ startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" }, "endsAt");
    await bad({ startsAt: "not a date" }, "startsAt");
    await bad({ usageLimit: 0 }, "usageLimit");
    await bad({ usageLimit: 5, perCustomerLimit: 6 }, "perCustomerLimit");
    await bad({ minSubtotalPaise: -1 }, "minSubtotalPaise");
    await bad({ maxDiscountPaise: 0 }, "maxDiscountPaise");
    await bad({ code: "a b" }, "code");
    await bad({ code: "ab" }, "code");
    await bad({ kind: "free_shipping", value: 0, maxDiscountPaise: 100 }, "maxDiscountPaise");
    await bad({ scope: { vibes: ["no-such-vibe"] } }, "scope.vibes");
    await bad({ scope: { types: ["nope"] } }, "scope.types");
    await bad({ scope: { products: ["00000000-0000-4000-8000-000000000000"] } }, "scope.products");
    const p = f.products["skull-charm"]!;
    await bad({ scope: { products: [p], excludeProducts: [p] } }, "scope.excludeProducts");
    // 100% is allowed
    await createCoupon(db(), { ...base, code: "FREE100", value: 10000 }, owner);
    // free shipping always stores value 0
    const fs = await createCoupon(db(), { code: "SHIPFREE", kind: "free_shipping", value: 500 }, owner);
    expect((await db().select().from(coupons).where(eq(coupons.id, fs.id)))[0]!.value).toBe(0);
  });

  it("updates, deactivates and re-activates; a used code cannot be renamed", async () => {
    const c = await createCoupon(db(), base, owner);
    await updateCoupon(db(), c.id, { ...base, value: 1500, usageLimit: 10 }, owner);
    expect((await db().select().from(coupons).where(eq(coupons.id, c.id)))[0]).toMatchObject({ value: 1500, usageLimit: 10 });
    const [log] = await db().select().from(adminAuditLog).where(eq(adminAuditLog.action, "coupon.update"));
    expect(log!.diff).toMatchObject({ value: { from: 1000, to: 1500 } });

    await setCouponActive(db(), c.id, false, admin);
    expect((await db().select().from(coupons).where(eq(coupons.id, c.id)))[0]!.active).toBe(false);
    expect((await db().select().from(adminAuditLog).where(eq(adminAuditLog.action, "coupon.deactivate"))).length).toBe(1);
    // a deactivated code stops working at checkout
    const check = await validateCoupon(db(), "save10", [], null);
    expect(check.ok).toBe(false);
    await setCouponActive(db(), c.id, true, admin);

    // rename allowed while unused
    await updateCoupon(db(), c.id, { ...base, code: "RENAMED" }, owner);
    // use it, then renaming is refused
    await placeCodOrder([{ variantId: f.variants.skull!, qty: 2 }], { couponCode: "RENAMED" });
    const err = await updateCoupon(db(), c.id, { ...base, code: "ANOTHER" }, owner).catch((e) => e);
    expect(err).toBeInstanceOf(ZodError);
    expect((err as ZodError).issues[0]!.path).toEqual(["code"]);
    // renaming to a case variant of itself is fine
    await updateCoupon(db(), c.id, { ...base, code: "renamed", value: 1000 }, owner);
    await expect(setCouponActive(db(), "00000000-0000-4000-8000-000000000000", true, owner)).rejects.toThrow(/no longer exists/);
  });

  it("reports usage stats: redemptions by status, order value and discount", async () => {
    const c = await createCoupon(db(), { ...base, code: "SAVE10" }, owner);
    const { order } = await placeCodOrder([{ variantId: f.variants.skull!, qty: 2 }], { couponCode: "SAVE10" });
    const rows = await listCoupons(db(), owner);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stats).toMatchObject({ confirmed: 1, reserved: 0, released: 0, revenuePaise: order.totalPaise, discountPaise: order.discountPaise });
    expect(rows[0]!.stats.discountPaise).toBeGreaterThan(0);
    expect(rows[0]!.state).toBe("active");
    const detail = await getCoupon(db(), c.id, owner);
    expect(detail!.recent).toHaveLength(1);
    expect(detail!.recent[0]).toMatchObject({ ref: order.ref, status: "confirmed" });
  });

  it("derives states: scheduled, expired, exhausted, inactive", async () => {
    const day = 86_400_000;
    await createCoupon(db(), { ...base, code: "FUTURE", startsAt: new Date(Date.now() + day), endsAt: new Date(Date.now() + 2 * day) }, owner);
    await createCoupon(db(), { ...base, code: "PAST", startsAt: new Date(Date.now() - 3 * day), endsAt: new Date(Date.now() - day) }, owner);
    await createCoupon(db(), { ...base, code: "OFF", active: false }, owner);
    await createCoupon(db(), { ...base, code: "ONE", usageLimit: 1 }, owner);
    await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }], { couponCode: "ONE" });
    const states = Object.fromEntries((await listCoupons(db(), owner)).map((c) => [c.code, c.state]));
    expect(states).toEqual({ FUTURE: "scheduled", PAST: "expired", OFF: "inactive", ONE: "exhausted" });
  });

  it("denies the fulfilment role (view and manage) at service level", async () => {
    const c = await createCoupon(db(), base, owner);
    await expect(createCoupon(db(), { ...base, code: "NOPE" }, fulfilment)).rejects.toThrow(/Forbidden/);
    await expect(updateCoupon(db(), c.id, base, fulfilment)).rejects.toThrow(/Forbidden/);
    await expect(setCouponActive(db(), c.id, false, fulfilment)).rejects.toThrow(/Forbidden/);
    await expect(listCoupons(db(), fulfilment)).rejects.toThrow(/Forbidden/);
    await expect(getCoupon(db(), c.id, fulfilment)).rejects.toThrow(/Forbidden/);
    expect(await db().select().from(coupons)).toHaveLength(1);
  });
});

describe("coupon form conversion", () => {
  it("converts human units to storage units and back", () => {
    const form = { ...EMPTY_COUPON_FORM, code: "Save10", percent: "12.5", minSubtotal: "499", maxDiscount: "1,000.50", startsAt: "2026-11-01T10:30", usageLimit: "50" };
    expect(couponFormSchema.safeParse(form).success).toBe(true);
    expect(formToInput(form)).toMatchObject({
      kind: "percent",
      value: 1250,
      minSubtotalPaise: 49900,
      maxDiscountPaise: 100050,
      startsAt: "2026-11-01T05:00:00.000Z",
      usageLimit: 50,
      perCustomerLimit: null,
    });
    const back = couponToFormValues({
      code: "X", kind: "fixed", value: 15000, startsAt: new Date("2026-11-01T05:00:00Z"), endsAt: null, minSubtotalPaise: 0,
      maxDiscountPaise: null, usageLimit: null, perCustomerLimit: 3, active: true,
      scope: { vibes: ["cute"], types: [], products: [], excludeProducts: [] },
    } as never);
    expect(back).toMatchObject({ amount: "150", startsAt: "2026-11-01T10:30", perCustomerLimit: "3", minSubtotal: "", vibes: ["cute"] });
    expect(couponFormSchema.safeParse({ ...form, percent: "100.01" }).success).toBe(false);
    expect(couponFormSchema.safeParse({ ...form, startsAt: "2026-12-01T10:00", endsAt: "2026-11-01T10:00" }).success).toBe(false);
  });
});
