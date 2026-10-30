import { revalidateStock } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import { cronUnauthorized, isCronAuthorized } from "@/server/payments/cron-auth";
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
    console.error("release-reservations failed", e instanceof Error ? e.message : "unknown");
    return Response.json({ ok: false }, { status: 500 });
  }
}
