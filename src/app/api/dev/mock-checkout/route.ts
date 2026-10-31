import { eq } from "drizzle-orm";
import { z } from "zod";

import { revalidateStock } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import { payments } from "@/server/db/schema";
import type { MockPaymentProvider } from "@/server/payments/mock";
import { getPaymentProvider, isMockProvider } from "@/server/payments/registry";
import { handleRazorpayWebhook } from "@/server/payments/webhook";

/**
 * DEV ONLY. Stands in for the Razorpay Checkout popup when no Razorpay keys are configured, so the
 * checkout UI can be exercised end to end. Answers 404 in production and whenever the real provider
 * is active, so it cannot be used to fake a payment.
 *
 * POST { razorpayOrderId, outcome: "success" | "authorized" | "failure" | "dismiss", webhook?: boolean }
 *  - success:    records a CAPTURED payment on the mock and returns `checkout`, the three fields
 *                Checkout.js would pass to its `handler`. POST them to /api/payments/razorpay/verify.
 *  - authorized: same, but the payment is only authorized (verify captures it through the API).
 *  - failure:    records a failed payment and delivers a `payment.failed` webhook; returns `error`
 *                like Checkout.js' `payment.failed` event. The order stays pending (retryable).
 *  - dismiss:    the customer closed the popup; nothing happens server side.
 *  - webhook:    also deliver the signed `payment.captured` webhook in-process (success/authorized).
 */
const bodySchema = z.object({
  razorpayOrderId: z.string().min(1).max(64),
  outcome: z.enum(["success", "authorized", "failure", "dismiss"]),
  webhook: z.boolean().optional(),
});

const notFound = () => new Response("Not found", { status: 404 });

export async function POST(req: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") return notFound();
  let provider: MockPaymentProvider;
  try {
    const active = getPaymentProvider();
    // By name, not `instanceof`: the dev server bundles this route and the registry separately, so each
    // gets its own copy of the class and `instanceof` is false for the very instance the registry made.
    if (!isMockProvider(active)) return notFound();
    provider = active as MockPaymentProvider;
  } catch {
    return notFound();
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  const { razorpayOrderId, outcome, webhook } = parsed.data;
  if (outcome === "dismiss") return Response.json({ ok: true, outcome });

  const db = getDb();
  const [row] = await db.select().from(payments).where(eq(payments.providerOrderId, razorpayOrderId)).limit(1);
  if (!row) return Response.json({ ok: false, error: "unknown_order" }, { status: 404 });
  provider.registerOrder(razorpayOrderId, row.amountPaise);

  const deliver = async (event: "payment.captured" | "payment.authorized" | "payment.failed", payment: ReturnType<MockPaymentProvider["simulatePayment"]>) => {
    const hook = provider.buildWebhook(event, { payment });
    const out = await handleRazorpayWebhook(db, provider, {
      rawBody: hook.rawBody,
      signature: hook.signature,
      eventId: hook.eventId,
    });
    if (out.productIds.length > 0) {
      try {
        revalidateStock({ productIds: out.productIds }, { via: "route" });
      } catch {
        /* cache invalidation is best effort */
      }
    }
    return out.status;
  };

  if (outcome === "failure") {
    const payment = provider.simulatePayment(razorpayOrderId, { status: "failed" });
    await deliver("payment.failed", payment);
    return Response.json({
      ok: true,
      outcome,
      error: { code: payment.errorCode, description: payment.errorDescription },
    });
  }

  const payment = provider.simulatePayment(razorpayOrderId, {
    status: outcome === "authorized" ? "authorized" : "captured",
  });
  if (webhook) await deliver(outcome === "authorized" ? "payment.authorized" : "payment.captured", payment);
  return Response.json({ ok: true, outcome, checkout: provider.checkoutResponse(payment) });
}
