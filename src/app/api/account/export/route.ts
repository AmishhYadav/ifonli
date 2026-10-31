import { keyDigest } from "@/features/cart/request";
import { getOptionalCustomer } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { exportCustomerData } from "@/server/services/dpdp";
import { consumeRateLimit } from "@/server/services/rate-limit";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/account/export: "Download my data" (DPDP). The signed-in customer's profile, addresses,
 * orders, wishlist and support cases as one JSON file. Session-gated (a guest or a staff session gets
 * a 401, never someone else's data) and rate limited, because it is a heavy read of personal data.
 */
export async function GET(): Promise<Response> {
  const customer = await getOptionalCustomer();
  if (!customer) return new Response("Please sign in", { status: 401, headers: NO_STORE });

  const db = getDb();
  const limit = await consumeRateLimit(db, `account-export:${keyDigest(customer.user.id)}`, {
    limit: 5,
    windowSeconds: 3600,
  });
  if (!limit.allowed) {
    return new Response("Too many downloads. Please try again later.", {
      status: 429,
      headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const data = await exportCustomerData(db, customer.user.id);
  if (!data) return new Response("Not found", { status: 404, headers: NO_STORE });
  const day = data.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="ifonli-my-data-${day}.json"`,
    },
  });
}
