"use server";

import { z } from "zod";

import { runAdminAction, type ActionResult } from "@/app/admin/_lib/action";
import { revalidateStock } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import {
  addInternalNote,
  addShipment,
  cancelOrder,
  markCodCollected,
  refundOrder,
  resendNotification,
  updateFulfilment,
  type CancelResult,
  type OrderMutationResult,
  type RefundResult,
} from "@/server/services/admin/orders";

const idSchema = z.uuid();

function done(result: OrderMutationResult): { orderId: string } {
  if (result.productIds.length > 0) revalidateStock({ productIds: result.productIds });
  return { orderId: result.orderId };
}

export async function updateFulfilmentAction(orderId: string, input: unknown): Promise<ActionResult<{ orderId: string }>> {
  return runAdminAction("order:update_fulfilment", async ({ actor }) =>
    done(await updateFulfilment(getDb(), idSchema.parse(orderId), input, actor)),
  );
}

export async function addShipmentAction(orderId: string, input: unknown): Promise<ActionResult<{ orderId: string }>> {
  return runAdminAction("order:add_shipment", async ({ actor }) =>
    done(await addShipment(getDb(), idSchema.parse(orderId), input, actor)),
  );
}

export async function markCodCollectedAction(orderId: string): Promise<ActionResult<{ orderId: string }>> {
  return runAdminAction("order:mark_cod_collected", async ({ actor }) =>
    done(await markCodCollected(getDb(), idSchema.parse(orderId), actor)),
  );
}

export async function cancelOrderAction(orderId: string, input: unknown): Promise<ActionResult<CancelResult>> {
  return runAdminAction("order:cancel", async ({ actor }) => {
    const res = await cancelOrder(getDb(), idSchema.parse(orderId), input, actor);
    done(res);
    return res;
  });
}

export async function refundOrderAction(orderId: string, input: unknown): Promise<ActionResult<RefundResult>> {
  return runAdminAction("order:refund", async ({ actor }) => {
    const res = await refundOrder(getDb(), idSchema.parse(orderId), input, actor);
    done(res);
    return res;
  });
}

export async function addNoteAction(orderId: string, input: unknown): Promise<ActionResult<{ orderId: string }>> {
  return runAdminAction("order:note", async ({ actor }) =>
    done(await addInternalNote(getDb(), idSchema.parse(orderId), input, actor)),
  );
}

export async function resendNotificationAction(orderId: string, input: unknown): Promise<ActionResult<{ orderId: string }>> {
  return runAdminAction("order:resend_notification", async ({ actor }) =>
    done(await resendNotification(getDb(), idSchema.parse(orderId), input, actor)),
  );
}
