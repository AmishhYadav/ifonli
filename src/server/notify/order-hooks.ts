import "server-only";

import type { PlacedOrder } from "@/server/services/orders";
import type { DbClient } from "@/server/services/queries/shared";

import { enqueueAdminAlert, enqueueCustomerNotification } from "./outbox";

/**
 * `createFromCart` hook (runs inside the order transaction): a COD order is confirmed on placement, so
 * the customer ("cod_placed") and the admins ("new_order") are told now; both rows commit or roll back
 * with the order. A prepaid order is announced when its payment is captured (`finalizePaidOrder`).
 * The raw guest token is deliberately not put in the payload: the e-mail links to /track.
 */
export async function onOrderPlacedInTransaction(tx: DbClient, order: PlacedOrder): Promise<void> {
  if (order.paymentMethod !== "cod") return;
  await enqueueCustomerNotification(tx, {
    orderId: order.orderId,
    template: "cod_placed",
    to: order.email,
    payload: { ref: order.ref, orderId: order.orderId, totalPaise: order.totalPaise },
  });
  await enqueueAdminAlert(tx, {
    orderId: order.orderId,
    template: "new_order",
    payload: { ref: order.ref, orderId: order.orderId, totalPaise: order.totalPaise, paymentMethod: "cod" },
  });
}
