import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as devCheckout } from "@/app/api/dev/mock-checkout/route";
import { getDb } from "@/server/db";
import { orders, payments } from "@/server/db/schema";
import { MockPaymentProvider } from "@/server/payments/mock";
import { setPaymentProvider } from "@/server/payments/registry";
import { handleVerifyRequest } from "@/server/payments/verify";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { configureCommerce, placePrepaidOrder, seedCommerceReference } from "./helpers/factories";

const db = () => getDb();
let f: Fixture;
let provider: MockPaymentProvider;

beforeEach(async () => {
  provider = new MockPaymentProvider({ deterministic: true });
  setPaymentProvider(provider);
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
});
afterEach(() => {
  setPaymentProvider(null);
  vi.unstubAllEnvs();
});

const call = (body: unknown) =>
  devCheckout(new Request("http://localhost/api/dev/mock-checkout", { method: "POST", body: JSON.stringify(body) }));
const orderRow = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!;

describe("dev mock checkout", () => {
  it("success: returns the three Checkout.js fields, which the verify endpoint accepts", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const res = await call({ razorpayOrderId: placed.payment.razorpayOrderId, outcome: "success" });
    const json = (await res.json()) as { ok: boolean; checkout: Record<string, string> };
    expect(json.ok).toBe(true);
    const v = await handleVerifyRequest(db(), provider, { ...json.checkout, ref: placed.order.ref, token: placed.token }, { ip: "5.5.5.5" });
    expect(v.status).toBe(200);
    expect((await orderRow(placed.order.orderId)).status).toBe("confirmed");
  });

  it("survives a server restart (the mock forgot the order) by re-reading the stored amount", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    provider.orders.clear();
    const res = await call({ razorpayOrderId: placed.payment.razorpayOrderId, outcome: "authorized", webhook: true });
    expect(res.status).toBe(200);
    // the in-process webhook already captured + confirmed it
    expect((await orderRow(placed.order.orderId)).status).toBe("confirmed");
  });

  it("failure: records the failed attempt and leaves the order retryable", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const json = (await (await call({ razorpayOrderId: placed.payment.razorpayOrderId, outcome: "failure" })).json()) as {
      error: { code: string };
    };
    expect(json.error.code).toBe("BAD_REQUEST_ERROR");
    expect(await orderRow(placed.order.orderId)).toMatchObject({ status: "pending_payment", paymentStatus: "failed" });
    expect((await db().select().from(payments))[0]!.status).toBe("failed");
  });

  it("dismiss does nothing server side", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    expect((await call({ razorpayOrderId: placed.payment.razorpayOrderId, outcome: "dismiss" })).status).toBe(200);
    expect(provider.payments.size).toBe(0);
  });

  it("is a 404 in production and whenever the real provider is active", async () => {
    const placed = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    vi.stubEnv("NODE_ENV", "production");
    expect((await call({ razorpayOrderId: placed.payment.razorpayOrderId, outcome: "success" })).status).toBe(404);
    vi.unstubAllEnvs();
    setPaymentProvider({ ...provider, name: "razorpay" } as never);
    expect((await call({ razorpayOrderId: placed.payment.razorpayOrderId, outcome: "success" })).status).toBe(404);
    expect(provider.payments.size).toBe(0);
  });
});
