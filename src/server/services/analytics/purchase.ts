import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { SESSION_ID_PATTERN } from "@/lib/analytics/events";
import { analyticsEvents, orderItems, orders } from "@/server/db/schema";
import type { DbClient } from "@/server/services/queries/shared";

/**
 * Server-side commerce events (plan 12). They are written inside the order transactions so they commit
 * or roll back with the order, but each write runs in its own savepoint and swallows its own failure:
 * analytics must never be the reason an order cannot be placed or confirmed.
 */

async function safely(tx: DbClient, label: string, run: (inner: DbClient) => Promise<void>): Promise<void> {
  try {
    await tx.transaction(async (inner) => run(inner as unknown as DbClient));
  } catch (e) {
    console.error(`analytics ${label} failed`, e instanceof Error ? e.message : "unknown");
  }
}

/** Remembers which anonymous session placed the order (prepaid orders are confirmed later, by webhook, with no cookies). */
export async function recordOrderPlaced(
  tx: DbClient,
  order: { id: string; vibeAtOrder: string | null; placedAt: Date },
  sessionId: string | null | undefined,
): Promise<void> {
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) return;
  await safely(tx, "order_placed", async (inner) => {
    await inner.insert(analyticsEvents).values({
      sessionId,
      event: "order_placed",
      vibe: order.vibeAtOrder,
      meta: { orderId: order.id },
      ts: order.placedAt,
    });
  });
}

/**
 * Records the sale: one `purchase` event for the order (value = total in paise) and one `purchase_item`
 * per product (value = revenue of that product's lines, `meta.qty` = units). Idempotent per order.
 * Called when a COD order is placed and when a prepaid order is finalized (payment captured).
 */
export async function recordPurchase(
  tx: DbClient,
  orderId: string,
  opts: { sessionId?: string | null; now?: Date } = {},
): Promise<void> {
  await safely(tx, "purchase", async (inner) => {
    const [order] = await inner
      .select({
        id: orders.id,
        totalPaise: orders.totalPaise,
        paymentMethod: orders.paymentMethod,
        vibeAtOrder: orders.vibeAtOrder,
        placedAt: orders.placedAt,
      })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!order) return;

    const orderIdIs = sql`${analyticsEvents.meta}->>'orderId' = ${orderId}`;
    const since = gte(analyticsEvents.ts, order.placedAt);
    const [existing] = await inner
      .select({ id: analyticsEvents.id })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.event, "purchase"), since, orderIdIs))
      .limit(1);
    if (existing) return;

    let sessionId = opts.sessionId && SESSION_ID_PATTERN.test(opts.sessionId) ? opts.sessionId : null;
    if (!sessionId) {
      const [placed] = await inner
        .select({ sessionId: analyticsEvents.sessionId })
        .from(analyticsEvents)
        .where(and(eq(analyticsEvents.event, "order_placed"), since, orderIdIs))
        .limit(1);
      sessionId = placed?.sessionId ?? null;
    }
    // Orders with no known visit still count as sales; they just cannot join a funnel.
    const sid = sessionId ?? `order:${orderId}`;

    const items = await inner
      .select({
        productId: orderItems.productId,
        qty: sql<number>`sum(${orderItems.qty})::int`,
        revenue: sql<number>`sum(${orderItems.lineTotalPaise})::float8`,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .groupBy(orderItems.productId);

    const ts = opts.now ?? new Date();
    await inner.insert(analyticsEvents).values([
      {
        sessionId: sid,
        event: "purchase",
        vibe: order.vibeAtOrder,
        value: order.totalPaise,
        meta: { orderId, method: order.paymentMethod, items: items.reduce((n, i) => n + i.qty, 0) },
        ts,
      },
      ...items.flatMap((i) =>
        i.productId
          ? [
              {
                sessionId: sid,
                event: "purchase_item",
                productId: i.productId,
                vibe: order.vibeAtOrder,
                value: Math.round(i.revenue),
                meta: { orderId, qty: i.qty },
                ts,
              },
            ]
          : [],
      ),
    ]);
  });
}
