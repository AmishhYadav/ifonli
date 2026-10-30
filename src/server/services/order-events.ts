import "server-only";

import { orderEvents } from "@/server/db/schema";

import type { DbClient } from "./queries/shared";

/** Appends to the order timeline (`order_events` is append-only). Pass the open transaction. */
export async function addOrderEvent(
  tx: DbClient,
  orderId: string,
  e: {
    type: string;
    from?: string | null;
    to?: string | null;
    note?: string | null;
    /** Shown on the customer's order page. Internal events (anomalies, alerts) stay hidden. */
    visible?: boolean;
    actorId?: string | null;
  },
): Promise<void> {
  await tx.insert(orderEvents).values({
    orderId,
    type: e.type,
    fromValue: e.from ?? null,
    toValue: e.to ?? null,
    note: e.note ?? null,
    actorId: e.actorId ?? null,
    visibleToCustomer: e.visible ?? false,
  });
}
