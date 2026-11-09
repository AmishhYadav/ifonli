import { captureException } from "@/lib/monitoring/sentry";
import { revalidateStock } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import { cronUnauthorized, isCronAuthorized } from "@/server/payments/cron-auth";
import { PaymentConfigError } from "@/server/payments/provider";
import { getPaymentProvider } from "@/server/payments/registry";
import { releaseDueReservations } from "@/server/payments/reconcile";

/** Every 5 minutes: expire lapsed reservations, after asking Razorpay so a paid order is never expired. */
export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();
  try {
    const { productIds, ...stats } = await releaseDueReservations(getDb(), getPaymentProvider());
    if (productIds.length > 0 || stats.swept > 0) {
      // Reservations no longer count against availability: refresh the cached product cards.
      revalidateStock({ productIds }, { via: "route" });
    }
    return Response.json({ ok: true, ...stats });
  } catch (e) {
    // No Razorpay keys yet (before live KYC): no order can be paid, so there is nothing to do.
    if (e instanceof PaymentConfigError) return Response.json({ ok: true, skipped: "payments_not_configured" });
    console.error("release-reservations failed", e instanceof Error ? e.message : "unknown");
    await captureException(e, { source: "cron", route: "/api/cron/release-reservations" });
    return Response.json({ ok: false }, { status: 500 });
  }
}
