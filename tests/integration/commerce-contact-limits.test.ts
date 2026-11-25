import { and, eq, like } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/server/db";
import { orders, rateLimits } from "@/server/db/schema";
import { createFromCart, type CreateFromCartResult } from "@/server/services/orders";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { checkoutForm, configureCommerce, makeCart, seedCommerceReference } from "./helpers/factories";

const db = () => getDb();
let f: Fixture;

beforeEach(async () => {
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
});
afterEach(() => vi.unstubAllEnvs());

const MESSAGE =
  "We've received several orders with these details today. Please try again tomorrow or contact us.";

/** A valid, distinct Indian mobile number per index. */
const phoneN = (i: number) => `9000000${String(100 + i)}`;
const emailN = (i: number) => `shopper${i}@example.com`;

/** Places one order on a fresh cart with the budgets enforced; `form` overrides the contact. */
async function place(
  form: Record<string, unknown>,
  extra: Partial<Parameters<typeof createFromCart>[1]> = {},
): Promise<CreateFromCartResult> {
  const cart = await makeCart([{ variantId: f.variants.ghost!, qty: 1 }]);
  return createFromCart(db(), {
    cartToken: cart.token,
    form: checkoutForm(form),
    enforceContactLimits: true,
    ...extra,
  });
}

function ok(r: CreateFromCartResult) {
  if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
  return r;
}
function err(r: CreateFromCartResult) {
  if (r.ok) throw new Error("expected an error, got an order");
  return r.error;
}

const orderCount = async () => (await db().select().from(orders)).length;

describe("createFromCart: per-contact daily order budgets", () => {
  it("refuses the 6th order for one e-mail (any payment method) but a replay of an earlier order still returns it", async () => {
    const carts: { token: string; form: Record<string, unknown> }[] = [];
    const placed: string[] = [];
    for (let i = 0; i < 5; i++) {
      // Same e-mail every time (different letter case on purpose), a different phone each time.
      const form = checkoutForm({
        email: i % 2 ? "Repeat@Example.com" : "repeat@example.com",
        phone: phoneN(i),
      });
      const cart = await makeCart([{ variantId: f.variants.ghost!, qty: 1 }]);
      carts.push({ token: cart.token, form });
      placed.push(
        ok(await createFromCart(db(), { cartToken: cart.token, form, enforceContactLimits: true })).order
          .orderId,
      );
    }
    expect(await orderCount()).toBe(5);

    const sixth = err(await place({ email: "REPEAT@example.com", phone: phoneN(9) }));
    expect(sixth.code).toBe("rate_limited");
    expect(sixth.message).toBe(MESSAGE);
    expect(sixth.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(sixth.retryAfterSeconds).toBeLessThanOrEqual(86_400);
    expect(await orderCount()).toBe(5); // nothing was created

    // The refusal is rolled back with the transaction: the counter still reads 5, not 6.
    const [row] = await db().select().from(rateLimits).where(like(rateLimits.key, "order:email:%"));
    expect(row!.count).toBe(5);

    // A repeat submit of an order that already exists is never refused.
    const again = ok(
      await createFromCart(db(), {
        cartToken: carts[2]!.token,
        form: carts[2]!.form,
        enforceContactLimits: true,
      }),
    );
    expect(again.replayed).toBe(true);
    expect(again.order.orderId).toBe(placed[2]);
    expect(await orderCount()).toBe(5);

    // Another e-mail is unaffected (same shopper, different details).
    ok(await place({ email: "someone.else@example.com", phone: phoneN(20) }));
  });

  it("refuses the 4th cash-on-delivery order for one phone, however it is written, but still takes prepaid ones", async () => {
    const writings = ["98765 43210", "+91 98765 43210", "09876543210", "(+91) 98765-43210"];
    for (let i = 0; i < 3; i++) {
      ok(await place({ paymentMethod: "cod", phone: writings[i], email: emailN(i) }));
    }
    const fourth = err(await place({ paymentMethod: "cod", phone: writings[3], email: emailN(3) }));
    expect(fourth).toMatchObject({ code: "rate_limited", message: MESSAGE });
    expect(fourth.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(await orderCount()).toBe(3);

    // The COD budget is separate from the overall one: prepaid orders keep going up to 5 in total.
    ok(await place({ paymentMethod: "razorpay", phone: "9876543210", email: emailN(4) }));
    ok(await place({ paymentMethod: "razorpay", phone: "9876543210", email: emailN(5) }));
    const sixth = err(await place({ paymentMethod: "razorpay", phone: "9876543210", email: emailN(6) }));
    expect(sixth.code).toBe("rate_limited");
    expect(await orderCount()).toBe(5);
  });

  it("keys are digests: no e-mail or phone number is stored in rate_limits", async () => {
    ok(await place({ paymentMethod: "cod", email: "digest.check@example.com", phone: "9123456789" }));
    const keys = (await db().select().from(rateLimits).where(like(rateLimits.key, "order%"))).map(
      (r) => r.key,
    );
    expect(keys).toHaveLength(4); // email + phone, overall + cod
    for (const k of keys) {
      expect(k).not.toContain("digest.check");
      expect(k).not.toContain("9123456789");
    }
  });

  it("does not use up budget when the order fails for another reason", async () => {
    // A quantity over the per-line cap fails inside the transaction, after the budget was counted.
    for (let i = 0; i < 6; i++) {
      const cart = await makeCart([{ variantId: f.variants.ghost!, qty: 11 }]);
      const e = err(
        await createFromCart(db(), {
          cartToken: cart.token,
          form: checkoutForm({ email: "unlucky@example.com", phone: "9000000999", paymentMethod: "cod" }),
          enforceContactLimits: true,
        }),
      );
      expect(e.code).toBe("insufficient_stock");
    }
    ok(await place({ email: "unlucky@example.com", phone: "9000000999", paymentMethod: "cod" }));
    const rows = await db()
      .select()
      .from(rateLimits)
      .where(and(like(rateLimits.key, "order%")));
    expect(rows.every((r) => r.count === 1)).toBe(true);
  });

  it("gives the budget back when the payment could not be started", async () => {
    const down = async () => ({ ok: false as const, message: "Razorpay is down" });
    for (let i = 0; i < 7; i++) {
      const e = err(await place({ email: "outage@example.com", phone: "9000000888" }, { initiatePayment: down }));
      expect(e.code).toBe("payment_init_failed"); // never rate_limited: the dead attempts cost nothing
    }
    const good = ok(await place({ email: "outage@example.com", phone: "9000000888" }));
    expect(good.order.status).toBe("pending_payment");
    const mine = await db().select().from(orders).where(eq(orders.email, "outage@example.com"));
    expect(mine.filter((o) => o.status === "expired")).toHaveLength(7);
  });

  it("is on by default; only the e2e switch outside production relaxes it", async () => {
    // The suite-wide setup sets E2E_MOCK_CHECKOUT=1, so without the explicit flag the budget is off...
    for (let i = 0; i < 6; i++) {
      const cart = await makeCart([{ variantId: f.variants.ghost!, qty: 1 }]);
      ok(
        await createFromCart(db(), {
          cartToken: cart.token,
          form: checkoutForm({ email: "relaxed@example.com", phone: phoneN(30 + i) }),
        }),
      );
    }
    // ...and with the switch removed the plain call (no flag) is limited like production.
    vi.stubEnv("E2E_MOCK_CHECKOUT", "");
    const plain = async (i: number) => {
      const cart = await makeCart([{ variantId: f.variants.ghost!, qty: 1 }]);
      return createFromCart(db(), {
        cartToken: cart.token,
        form: checkoutForm({ email: "limited@example.com", phone: phoneN(40 + i) }),
      });
    };
    for (let i = 0; i < 5; i++) ok(await plain(i));
    expect(err(await plain(5)).code).toBe("rate_limited");
  });
});
