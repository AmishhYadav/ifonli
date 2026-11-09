import { captureException } from "@/lib/monitoring/sentry";
import { revalidateStock } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import { cronUnauthorized, isCronAuthorized } from "@/server/payments/cron-auth";
import { PaymentConfigError } from "@/server/payments/provider";
import { getPaymentProvider } from "@/server/payments/registry";
import { reconcileAll } from "@/server/payments/reconcile";

/** Every 10 minutes: finalise / expire pending orders against Razorpay, retry stuck refunds. */
export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();
  try {
    const { payments, refunds } = await reconcileAll(getDb(), getPaymentProvider());
    const { productIds, ...paymentStats } = payments;
    if (productIds.length > 0) revalidateStock({ productIds }, { via: "route" });
    return Response.json({ ok: true, payments: paymentStats, refunds });
  } catch (e) {
    // No Razorpay keys yet (before live KYC): no order can be paid, so there is nothing to do.
    if (e instanceof PaymentConfigError) return Response.json({ ok: true, skipped: "payments_not_configured" });
    console.error("reconcile-payments failed", e instanceof Error ? e.message : "unknown");
    await captureException(e, { source: "cron", route: "/api/cron/reconcile-payments" });
    return Response.json({ ok: false }, { status: 500 });
  }
}
