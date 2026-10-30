import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import {
  addresses,
  coupons,
  orders,
  payments,
  productVibes,
  user,
  variants,
  vibes,
  webhookEvents,
} from "@/server/db/schema";

import { createSql } from "./helpers/db";
import { makeProduct, makeVariant, PG, pgErrorCode } from "./helpers/factories";

const sql = createSql();
afterAll(() => sql.end());

const db = () => getDb();

async function makeOrder(overrides: Partial<typeof orders.$inferInsert> = {}) {
  const n = Math.random().toString(36).slice(2, 10);
  const [row] = await db()
    .insert(orders)
    .values({
      ref: `IFO-TEST-${n}`,
      email: "a@example.com",
      paymentMethod: "razorpay",
      subtotalPaise: 10000,
      totalPaise: 10000,
      shippingAddress: {},
      idempotencyKey: `idem-${n}`,
      ...overrides,
    })
    .returning();
  return row!;
}

describe("variants", () => {
  it("rejects negative stock_on_hand", async () => {
    const product = await makeProduct();
    const code = await pgErrorCode(makeVariant(product.id, { stockOnHand: -1 }));
    expect(code).toBe(PG.check);
  });

  it("rejects an update that would drive stock below zero", async () => {
    const product = await makeProduct();
    const variant = await makeVariant(product.id, { stockOnHand: 1 });
    const code = await pgErrorCode(
      sql`UPDATE variants SET stock_on_hand = stock_on_hand - 2 WHERE id = ${variant.id}`,
    );
    expect(code).toBe(PG.check);
  });

  it("rejects price_paise > mrp_paise", async () => {
    const product = await makeProduct();
    const code = await pgErrorCode(makeVariant(product.id, { pricePaise: 15000, mrpPaise: 12000 }));
    expect(code).toBe(PG.check);
  });

  it("accepts price == mrp", async () => {
    const product = await makeProduct();
    const v = await makeVariant(product.id, { pricePaise: 12000, mrpPaise: 12000 });
    expect(v.pricePaise).toBe(12000);
  });

  it("rejects duplicate SKUs", async () => {
    const product = await makeProduct();
    await makeVariant(product.id, { sku: "DUP-1" });
    const code = await pgErrorCode(makeVariant(product.id, { sku: "DUP-1" }));
    expect(code).toBe(PG.unique);
  });

  it("round-trips bigint paise as numbers", async () => {
    const product = await makeProduct();
    const v = await makeVariant(product.id, { pricePaise: 4_999_900, mrpPaise: 4_999_900 });
    const [row] = await db().select().from(variants).where(eq(variants.id, v.id));
    expect(row?.pricePaise).toBe(4_999_900);
  });
});

describe("coupons", () => {
  it("enforces case-insensitive code uniqueness", async () => {
    await db().insert(coupons).values({ code: "SAVE10", kind: "percent", value: 1000 });
    const code = await pgErrorCode(
      db().insert(coupons).values({ code: "save10", kind: "percent", value: 500 }),
    );
    expect(code).toBe(PG.unique);
  });

  it("validates value against kind", async () => {
    expect(
      await pgErrorCode(
        db().insert(coupons).values({ code: "BAD1", kind: "percent", value: 10001 }),
      ),
    ).toBe(PG.check);
    expect(
      await pgErrorCode(
        db().insert(coupons).values({ code: "BAD2", kind: "free_shipping", value: 5 }),
      ),
    ).toBe(PG.check);
    await db().insert(coupons).values({ code: "SHIP", kind: "free_shipping", value: 0 });
  });
});

describe("orders and payments", () => {
  it("enforces unique ref and idempotency_key", async () => {
    const o = await makeOrder();
    expect(await pgErrorCode(makeOrder({ ref: o.ref }))).toBe(PG.unique);
    expect(await pgErrorCode(makeOrder({ idempotencyKey: o.idempotencyKey }))).toBe(PG.unique);
  });

  it("requires total = subtotal - discount + shipping + cod fee", async () => {
    expect(await pgErrorCode(makeOrder({ subtotalPaise: 10000, totalPaise: 9999 }))).toBe(PG.check);
    await makeOrder({
      subtotalPaise: 10000,
      discountPaise: 1000,
      shippingPaise: 5000,
      codFeePaise: 4000,
      totalPaise: 18000,
    });
  });

  it("enforces unique provider_order_id and provider_payment_id, allowing many NULL payment ids", async () => {
    const o = await makeOrder();
    await db()
      .insert(payments)
      .values({ orderId: o.id, providerOrderId: "order_1", amountPaise: 100 });
    await db()
      .insert(payments)
      .values({ orderId: o.id, providerOrderId: "order_2", amountPaise: 100 });
    expect(
      await pgErrorCode(
        db()
          .insert(payments)
          .values({ orderId: o.id, providerOrderId: "order_1", amountPaise: 100 }),
      ),
    ).toBe(PG.unique);
    await db()
      .insert(payments)
      .values({
        orderId: o.id,
        providerOrderId: "order_3",
        providerPaymentId: "pay_1",
        amountPaise: 100,
      });
    expect(
      await pgErrorCode(
        db()
          .insert(payments)
          .values({
            orderId: o.id,
            providerOrderId: "order_4",
            providerPaymentId: "pay_1",
            amountPaise: 100,
          }),
      ),
    ).toBe(PG.unique);
  });

  it("dedupes webhook events by provider_event_id", async () => {
    await db()
      .insert(webhookEvents)
      .values({ providerEventId: "evt_1", type: "payment.captured", payload: {} });
    expect(
      await pgErrorCode(
        db()
          .insert(webhookEvents)
          .values({ providerEventId: "evt_1", type: "payment.captured", payload: {} }),
      ),
    ).toBe(PG.unique);
  });
});

describe("join tables and other uniqueness", () => {
  it("product_vibes has a composite primary key", async () => {
    const product = await makeProduct();
    const [vibe] = await db().insert(vibes).values({ slug: "cute", name: "Cute" }).returning();
    await db().insert(productVibes).values({ productId: product.id, vibeId: vibe!.id });
    expect(
      await pgErrorCode(
        db().insert(productVibes).values({ productId: product.id, vibeId: vibe!.id }),
      ),
    ).toBe(PG.unique);
  });

  it("allows only one default address per user", async () => {
    const [u] = await db()
      .insert(user)
      .values({ id: "u1", name: "U", email: "u@example.com", role: "customer" })
      .returning();
    const base = {
      userId: u!.id,
      name: "U",
      phone: "9999999999",
      line1: "1 St",
      city: "X",
      state: "Y",
      pincode: "110001",
    };
    await db()
      .insert(addresses)
      .values({ ...base, isDefault: true });
    await db()
      .insert(addresses)
      .values({ ...base, isDefault: false });
    expect(
      await pgErrorCode(
        db()
          .insert(addresses)
          .values({ ...base, isDefault: true }),
      ),
    ).toBe(PG.unique);
  });
});
