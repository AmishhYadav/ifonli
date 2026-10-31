import "server-only";

import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { formatINR } from "@/lib/money";
import { assertCan } from "@/server/auth/permissions";
import {
  inventoryMovements,
  notificationOutbox,
  orderEvents,
  orderItems,
  orders,
  payments,
  refunds,
  shipments,
  stockReservations,
  user,
  invoices,
} from "@/server/db/schema";
import {
  FULFILLMENT_STATUSES,
  ORDER_STATUSES,
  OrderTransitionError,
  PAYMENT_STATUSES,
  allowedTransitions,
  assertTransition,
  refundableAmount,
  type FulfillmentStatus,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@/server/domain";
import { enqueueCustomerNotification, enqueueNotification, type NotificationTemplate } from "@/server/notify/outbox";
import type { PaymentProvider } from "@/server/payments/provider";
import { writeAudit } from "@/server/services/audit";
import { releaseRedemption } from "@/server/services/coupons";
import { adjustStock } from "@/server/services/inventory";
import { addOrderEvent } from "@/server/services/order-events";
import type { DbClient } from "@/server/services/queries/shared";
import { createRefund, dispositionOf, loadRefundTotals, type PaymentDisposition } from "@/server/services/refunds";

import { trackingUrlFor } from "./couriers";
import { AdminInputError, type AdminActor } from "./products";

/* ------------------------------------------------------------------------------------------ */
/* Errors                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export class OrderNotFoundError extends AdminInputError {
  constructor() {
    super("That order no longer exists.");
    this.name = "OrderNotFoundError";
  }
}

type OrderRow = typeof orders.$inferSelect;

/** `assertTransition` with a message an admin can act on. */
function step<A extends "status" | "payment" | "fulfillment">(
  axis: A,
  from: string,
  to: string,
): void {
  try {
    assertTransition(axis, from as never, to as never);
  } catch (e) {
    if (e instanceof OrderTransitionError) {
      throw new AdminInputError(
        `This order is "${label(from)}"; it can't move to "${label(to)}" (${axis.replace("fulfillment", "fulfilment")} status).`,
      );
    }
    throw e;
  }
}

/** "out_for_delivery" -> "out for delivery". */
export function label(value: string): string {
  return value.replace(/_/g, " ");
}

async function lockOrder(tx: DbClient, orderId: string): Promise<OrderRow> {
  const [row] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!row) throw new OrderNotFoundError();
  return row;
}

export interface OrderMutationResult {
  orderId: string;
  /** Products whose stock changed (for `revalidateStock`). */
  productIds: string[];
}

/* ------------------------------------------------------------------------------------------ */
/* List                                                                                       */
/* ------------------------------------------------------------------------------------------ */

export const ORDER_LIST_PAGE_SIZE = 25;

export interface OrderListFilters {
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
  method?: PaymentMethod;
  /** Inclusive IST calendar dates, "YYYY-MM-DD". */
  from?: string;
  to?: string;
  /** Matches reference, e-mail, phone and the shipping name. */
  q?: string;
}

export interface OrderListRow {
  id: string;
  ref: string;
  placedAt: Date;
  customerName: string;
  email: string;
  phone: string | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  paymentMethod: PaymentMethod;
  totalPaise: number;
  itemCount: number;
}

export interface OrderList {
  items: OrderListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Start of the IST calendar day for "YYYY-MM-DD" (null if malformed). */
function istDayStart(date: string | undefined): Date | null {
  if (!date || !DATE_RE.test(date)) return null;
  const d = new Date(`${date}T00:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function likePattern(raw: string): string {
  return `%${raw.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

export function buildOrderListWhere(f: OrderListFilters): SQL | undefined {
  const conds: (SQL | undefined)[] = [];
  if (f.status && (ORDER_STATUSES as readonly string[]).includes(f.status)) {
    conds.push(eq(orders.status, f.status));
  }
  if (f.paymentStatus && (PAYMENT_STATUSES as readonly string[]).includes(f.paymentStatus)) {
    conds.push(eq(orders.paymentStatus, f.paymentStatus));
  }
  if (f.fulfillmentStatus && (FULFILLMENT_STATUSES as readonly string[]).includes(f.fulfillmentStatus)) {
    conds.push(eq(orders.fulfillmentStatus, f.fulfillmentStatus));
  }
  if (f.method === "razorpay" || f.method === "cod") conds.push(eq(orders.paymentMethod, f.method));
  const from = istDayStart(f.from);
  if (from) conds.push(gte(orders.placedAt, from));
  const to = istDayStart(f.to);
  if (to) conds.push(lt(orders.placedAt, new Date(to.getTime() + 86_400_000)));
  const q = f.q?.trim().slice(0, 100);
  if (q) {
    const pattern = likePattern(q);
    const digits = q.replace(/\D/g, "");
    conds.push(
      or(
        ilike(orders.ref, pattern),
        ilike(orders.email, pattern),
        sql`${orders.shippingAddress}->>'name' ilike ${pattern}`,
        digits.length >= 4 ? ilike(orders.phone, likePattern(digits)) : undefined,
      ),
    );
  }
  return conds.length ? and(...conds) : undefined;
}

/** Server-side paginated order list, newest first. */
export async function listAdminOrders(
  db: DbClient,
  params: OrderListFilters & { page?: number; pageSize?: number } = {},
): Promise<OrderList> {
  const pageSize = Math.min(100, Math.max(1, Math.trunc(params.pageSize ?? ORDER_LIST_PAGE_SIZE)));
  const where = buildOrderListWhere(params);
  const [totalRow] = await db.select({ n: count() }).from(orders).where(where);
  const total = totalRow?.n ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.trunc(params.page ?? 1) || 1));

  const rows = await db
    .select({
      id: orders.id,
      ref: orders.ref,
      placedAt: orders.placedAt,
      address: orders.shippingAddress,
      email: orders.email,
      phone: orders.phone,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      fulfillmentStatus: orders.fulfillmentStatus,
      paymentMethod: orders.paymentMethod,
      totalPaise: orders.totalPaise,
    })
    .from(orders)
    .where(where)
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const counts = rows.length
    ? await db
        .select({ orderId: orderItems.orderId, n: sql<number>`sum(${orderItems.qty})::int` })
        .from(orderItems)
        .where(inArray(orderItems.orderId, rows.map((r) => r.id)))
        .groupBy(orderItems.orderId)
    : [];
  const byOrder = new Map(counts.map((c) => [c.orderId, c.n]));

  return {
    items: rows.map((r) => ({
      id: r.id,
      ref: r.ref,
      placedAt: r.placedAt,
      customerName: addressName(r.address),
      email: r.email,
      phone: r.phone,
      status: r.status,
      paymentStatus: r.paymentStatus,
      fulfillmentStatus: r.fulfillmentStatus,
      paymentMethod: r.paymentMethod,
      totalPaise: r.totalPaise,
      itemCount: byOrder.get(r.id) ?? 0,
    })),
    total,
    page,
    pageSize,
    pageCount,
  };
}

function addressName(address: unknown): string {
  const name = (address as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : "";
}

/* ------------------------------------------------------------------------------------------ */
/* Available actions (pure: also unit-testable)                                               */
/* ------------------------------------------------------------------------------------------ */

export const FULFILMENT_STEP_LABELS: Record<FulfillmentStatus, string> = {
  unfulfilled: "Undo packed",
  packed: "Mark packed",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Mark delivered",
  rto: "Mark RTO",
  returned: "Mark returned",
};

export type ResendTemplate = "order_confirmed" | "order_shipped" | "order_delivered" | "order_cancelled";

export interface OrderActions {
  /** Fulfilment steps offered as buttons (never `shipped`: that goes through "Add shipment"). */
  fulfilment: FulfillmentStatus[];
  canAddShipment: boolean;
  canMarkCodCollected: boolean;
  canCancel: boolean;
  canRefund: boolean;
  resend: ResendTemplate[];
}

export function orderActions(
  order: Pick<OrderRow, "status" | "paymentStatus" | "fulfillmentStatus" | "paymentMethod">,
  ctx: { refundablePaise: number; hasShipment: boolean },
): OrderActions {
  const live = order.status === "confirmed" || order.status === "processing";
  const fulfilable = live || order.status === "completed";
  const f = order.fulfillmentStatus;
  const fulfilment = fulfilable
    ? allowedTransitions("fulfillment", f).filter((to) => to !== "shipped")
    : [];
  const resend: ResendTemplate[] = [];
  if (fulfilable) resend.push("order_confirmed");
  if (ctx.hasShipment) resend.push("order_shipped");
  if (f === "delivered") resend.push("order_delivered");
  if (order.status === "cancelled") resend.push("order_cancelled");
  return {
    fulfilment: [...fulfilment],
    canAddShipment: live && (f === "unfulfilled" || f === "packed" || f === "shipped" || f === "out_for_delivery"),
    canMarkCodCollected:
      order.paymentMethod === "cod" && order.paymentStatus === "cod_pending" && f === "delivered" && order.status !== "cancelled",
    canCancel:
      (order.status === "pending_payment" || live) && (f === "unfulfilled" || f === "packed"),
    canRefund:
      ctx.refundablePaise > 0 &&
      (order.paymentStatus === "paid" ||
        order.paymentStatus === "partially_refunded" ||
        order.paymentStatus === "cod_collected"),
    resend,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Detail                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export interface AdminOrderDetail {
  order: OrderRow;
  customerName: string;
  items: {
    id: string;
    variantId: string;
    productId: string | null;
    productName: string;
    variantTitle: string;
    sku: string;
    imagePath: string | null;
    unitPricePaise: number;
    qty: number;
    discountAllocPaise: number;
    lineTotalPaise: number;
    hsn: string | null;
    gstRateBp: number | null;
    taxPaise: number;
    /** Units not yet put back on the shelf (cancel/return restock). */
    restockable: number;
  }[];
  shipments: (typeof shipments.$inferSelect)[];
  payments: {
    id: string;
    providerPaymentId: string | null;
    providerOrderId: string;
    amountPaise: number;
    status: (typeof payments.$inferSelect)["status"];
    method: string | null;
    disposition: PaymentDisposition | null;
    createdAt: Date;
  }[];
  refunds: (typeof refunds.$inferSelect & { actorName: string | null })[];
  events: {
    id: string;
    type: string;
    fromValue: string | null;
    toValue: string | null;
    note: string | null;
    visibleToCustomer: boolean;
    actorName: string | null;
    createdAt: Date;
  }[];
  invoice: { number: string; kind: "tax_invoice" | "bill_of_supply"; hasPdf: boolean } | null;
  notifications: { id: string; template: string; status: string; attempts: number; createdAt: Date }[];
  money: {
    capturedPaise: number;
    /** Pending + processed + manual: not available for another refund. */
    committedPaise: number;
    /** Processed + manual: already back with the customer. */
    settledPaise: number;
    refundablePaise: number;
  };
  actions: OrderActions;
}

export async function getAdminOrderDetail(db: DbClient, orderId: string): Promise<AdminOrderDetail | null> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;

  const [items, shipmentRows, paymentRows, refundRows, eventRows, invoiceRows, outbox, moved, totals] =
    await Promise.all([
      db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.createdAt), asc(orderItems.id)),
      db.select().from(shipments).where(eq(shipments.orderId, orderId)).orderBy(asc(shipments.createdAt)),
      db.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(asc(payments.createdAt)),
      db
        .select({ r: refunds, actorName: user.name })
        .from(refunds)
        .leftJoin(user, eq(refunds.actorId, user.id))
        .where(eq(refunds.orderId, orderId))
        .orderBy(asc(refunds.createdAt)),
      db
        .select({ e: orderEvents, actorName: user.name })
        .from(orderEvents)
        .leftJoin(user, eq(orderEvents.actorId, user.id))
        .where(eq(orderEvents.orderId, orderId))
        .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id)),
      db.select().from(invoices).where(eq(invoices.orderId, orderId)).limit(1),
      db
        .select({
          id: notificationOutbox.id,
          template: notificationOutbox.template,
          status: notificationOutbox.status,
          attempts: notificationOutbox.attempts,
          createdAt: notificationOutbox.createdAt,
        })
        .from(notificationOutbox)
        .where(eq(notificationOutbox.orderId, orderId))
        .orderBy(asc(notificationOutbox.createdAt)),
      restockedByVariant(db, orderId),
      loadRefundTotals(db, order),
    ]);

  const refundablePaise = refundableAmount(totals.capturedPaise, totals.committedPaise);
  const invoice = invoiceRows[0];
  return {
    order,
    customerName: addressName(order.shippingAddress),
    items: items.map((i) => ({
      id: i.id,
      variantId: i.variantId,
      productId: i.productId,
      productName: i.productName,
      variantTitle: i.variantTitle,
      sku: i.sku,
      imagePath: i.imagePath,
      unitPricePaise: i.unitPricePaise,
      qty: i.qty,
      discountAllocPaise: i.discountAllocPaise,
      lineTotalPaise: i.lineTotalPaise,
      hsn: i.hsn,
      gstRateBp: i.gstRateBp,
      taxPaise: i.taxPaise,
      restockable: Math.max(0, i.qty - (moved.get(i.variantId) ?? 0)),
    })),
    shipments: shipmentRows,
    payments: paymentRows.map((p) => ({
      id: p.id,
      providerPaymentId: p.providerPaymentId,
      providerOrderId: p.providerOrderId,
      amountPaise: p.amountPaise,
      status: p.status,
      method: p.method,
      disposition: dispositionOf(p),
      createdAt: p.createdAt,
    })),
    refunds: refundRows.map((r) => ({ ...r.r, actorName: r.actorName })),
    events: eventRows.map(({ e, actorName }) => ({
      id: e.id,
      type: e.type,
      fromValue: e.fromValue,
      toValue: e.toValue,
      note: e.note,
      visibleToCustomer: e.visibleToCustomer,
      actorName,
      createdAt: e.createdAt,
    })),
    invoice: invoice ? { number: invoice.number, kind: invoice.kind, hasPdf: invoice.pdfPath !== null } : null,
    notifications: outbox,
    money: {
      capturedPaise: totals.capturedPaise,
      committedPaise: totals.committedPaise,
      settledPaise: totals.settledPaise,
      refundablePaise,
    },
    actions: orderActions(order, { refundablePaise, hasShipment: shipmentRows.length > 0 }),
  };
}

/** Units already put back per variant (cancel/return restock movements of this order). */
async function restockedByVariant(db: DbClient, orderId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ variantId: inventoryMovements.variantId, n: sql<number>`coalesce(sum(${inventoryMovements.delta}), 0)::int` })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.orderId, orderId),
        inArray(inventoryMovements.reason, ["cancel_restock", "return_restock"]),
      ),
    )
    .groupBy(inventoryMovements.variantId);
  return new Map(rows.map((r) => [r.variantId, r.n]));
}

/** Puts every not-yet-restocked unit of the order back on the shelf. Returns affected product ids. */
async function restockRemaining(
  tx: DbClient,
  order: OrderRow,
  reason: "cancel_restock" | "return_restock",
  actorId: string,
): Promise<string[]> {
  const [items, back] = await Promise.all([
    tx.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
    restockedByVariant(tx, order.id),
  ]);
  const remaining = new Map<string, { qty: number; productId: string | null }>();
  for (const i of items) {
    const cur = remaining.get(i.variantId);
    remaining.set(i.variantId, { qty: (cur?.qty ?? 0) + i.qty, productId: i.productId });
  }
  const productIds = new Set<string>();
  let units = 0;
  for (const [variantId, line] of [...remaining.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const qty = line.qty - (back.get(variantId) ?? 0);
    if (qty <= 0) continue;
    await adjustStock(
      { variantId, delta: qty, reason, actorId, orderId: order.id, note: `${label(reason)} (${order.ref})` },
      tx,
    );
    units += qty;
    if (line.productId) productIds.add(line.productId);
  }
  if (units > 0) {
    await addOrderEvent(tx, order.id, { type: "stock_restocked", note: `Restocked ${units} unit(s).`, actorId });
  }
  return [...productIds];
}

/* ------------------------------------------------------------------------------------------ */
/* Notifications                                                                              */
/* ------------------------------------------------------------------------------------------ */

function notificationPayload(
  template: ResendTemplate,
  order: OrderRow,
  shipment: typeof shipments.$inferSelect | undefined,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = { ref: order.ref, orderId: order.id };
  switch (template) {
    case "order_confirmed":
      return { ...base, totalPaise: order.totalPaise, paymentMethod: order.paymentMethod, ...extra };
    case "order_shipped":
      return {
        ...base,
        courier: shipment?.courier ?? null,
        awb: shipment?.awb ?? null,
        trackingUrl: shipment?.trackingUrl ?? null,
        ...extra,
      };
    case "order_delivered":
      return { ...base, ...extra };
    case "order_cancelled":
      return { ...base, ...extra };
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Fulfilment transitions                                                                     */
/* ------------------------------------------------------------------------------------------ */

export const fulfilmentInputSchema = z.object({
  to: z.enum(["packed", "unfulfilled", "out_for_delivery", "delivered", "rto", "returned"]),
  /** `returned` only: put the units back on the shelf (default yes). */
  restock: z.boolean().optional(),
});

const CUSTOMER_NOTES: Record<FulfillmentStatus, string> = {
  unfulfilled: "Your order is being prepared.",
  packed: "Your order has been packed.",
  shipped: "Your order has been shipped.",
  out_for_delivery: "Your order is out for delivery.",
  delivered: "Your order has been delivered.",
  rto: "The courier is returning the parcel to us.",
  returned: "The parcel is back with us.",
};

/**
 * Moves the fulfilment axis one legal step (packed, undo packed, out for delivery, delivered, RTO,
 * returned). `shipped` is only reachable through `addShipment`. Delivery completes the order;
 * a COD order that never reached the customer (RTO, returned) stops expecting cash.
 */
export async function updateFulfilment(
  db: DbClient,
  orderId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<OrderMutationResult> {
  assertCan(actor.role, "order:update_fulfilment");
  const input = fulfilmentInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!["confirmed", "processing", "completed"].includes(order.status)) {
      throw new AdminInputError(`A ${label(order.status)} order can't be fulfilled.`);
    }
    const from = order.fulfillmentStatus;
    step("fulfillment", from, input.to);

    const set: Partial<typeof orders.$inferInsert> = { fulfillmentStatus: input.to };
    let productIds: string[] = [];

    if (input.to === "delivered") {
      if (order.status === "confirmed") {
        step("status", "confirmed", "processing");
        step("status", "processing", "completed");
        set.status = "completed";
      } else if (order.status === "processing") {
        step("status", "processing", "completed");
        set.status = "completed";
      }
      await tx
        .update(shipments)
        .set({ status: "delivered", deliveredAt: new Date() })
        .where(and(eq(shipments.orderId, orderId), sql`${shipments.deliveredAt} is null`));
    }
    if ((input.to === "rto" || input.to === "returned") && order.paymentStatus === "cod_pending") {
      step("payment", "cod_pending", "failed");
      set.paymentStatus = "failed";
    }
    await tx.update(orders).set(set).where(eq(orders.id, orderId));

    await addOrderEvent(tx, orderId, {
      type: "fulfillment_changed",
      from,
      to: input.to,
      note: CUSTOMER_NOTES[input.to],
      visible: true,
      actorId: actor.id,
    });
    if (set.paymentStatus) {
      await addOrderEvent(tx, orderId, {
        type: "payment_status_changed",
        from: order.paymentStatus,
        to: set.paymentStatus,
        note: "Cash on delivery was not collected.",
        actorId: actor.id,
      });
    }
    if (input.to === "returned" && input.restock !== false) {
      productIds = await restockRemaining(tx, order, "return_restock", actor.id);
    }
    if (input.to === "delivered") {
      const [shipment] = await tx
        .select()
        .from(shipments)
        .where(eq(shipments.orderId, orderId))
        .orderBy(desc(shipments.createdAt))
        .limit(1);
      await enqueueCustomerNotification(tx, {
        orderId,
        template: "order_delivered",
        to: order.email,
        payload: notificationPayload("order_delivered", order, shipment),
      });
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: `order.${input.to === "unfulfilled" ? "unpack" : input.to}`,
      entity: "order",
      entityId: orderId,
      diff: { ref: order.ref, from, to: input.to, restock: input.to === "returned" ? input.restock !== false : undefined },
      ip: actor.ip,
    });
    return { orderId, productIds };
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Shipments                                                                                  */
/* ------------------------------------------------------------------------------------------ */

export const shipmentInputSchema = z.object({
  courier: z.string().trim().min(1, "Enter the courier").max(60),
  awb: z
    .string()
    .trim()
    .max(64)
    .nullish()
    .transform((v) => v || null),
  trackingUrl: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), "Use a full http(s) link"),
});

/**
 * Records a shipment (courier, AWB, tracking link), moves the order to `shipped` (stepping through
 * `packed` when staff skipped it) and queues the "order shipped" e-mail. On an already shipped
 * order it adds another parcel without a transition.
 */
export async function addShipment(
  db: DbClient,
  orderId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<OrderMutationResult & { shipmentId: string }> {
  assertCan(actor.role, "order:add_shipment");
  const input = shipmentInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== "confirmed" && order.status !== "processing") {
      throw new AdminInputError(`A ${label(order.status)} order can't be shipped.`);
    }
    const from = order.fulfillmentStatus;
    if (!["unfulfilled", "packed", "shipped", "out_for_delivery"].includes(from)) {
      throw new AdminInputError(`This order is already ${label(from)}.`);
    }
    const now = new Date();
    const trackingUrl = input.trackingUrl ?? trackingUrlFor(input.courier, input.awb);

    if (from === "unfulfilled") {
      step("fulfillment", "unfulfilled", "packed");
      await addOrderEvent(tx, orderId, {
        type: "fulfillment_changed",
        from,
        to: "packed",
        note: CUSTOMER_NOTES.packed,
        visible: true,
        actorId: actor.id,
      });
    }
    const set: Partial<typeof orders.$inferInsert> = {};
    if (from === "unfulfilled" || from === "packed") {
      step("fulfillment", "packed", "shipped");
      set.fulfillmentStatus = "shipped";
      if (order.status === "confirmed") {
        step("status", "confirmed", "processing");
        set.status = "processing";
      }
      await tx.update(orders).set(set).where(eq(orders.id, orderId));
    }

    const [shipment] = await tx
      .insert(shipments)
      .values({
        orderId,
        courier: input.courier,
        awb: input.awb,
        trackingUrl,
        status: "shipped",
        shippedAt: now,
        events: [{ at: now.toISOString(), status: "shipped", by: actor.id }],
      })
      .returning();
    await addOrderEvent(tx, orderId, {
      type: "shipment_added",
      from: from === "unfulfilled" || from === "packed" ? from : null,
      to: set.fulfillmentStatus ?? null,
      note: `Shipped with ${input.courier}${input.awb ? `, AWB ${input.awb}` : ""}.`,
      visible: true,
      actorId: actor.id,
    });
    await enqueueCustomerNotification(tx, {
      orderId,
      template: "order_shipped",
      to: order.email,
      payload: notificationPayload("order_shipped", order, shipment),
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "order.ship",
      entity: "order",
      entityId: orderId,
      diff: { ref: order.ref, courier: input.courier, awb: input.awb, trackingUrl },
      ip: actor.ip,
    });
    return { orderId, productIds: [], shipmentId: shipment!.id };
  });
}

/* ------------------------------------------------------------------------------------------ */
/* COD collected                                                                              */
/* ------------------------------------------------------------------------------------------ */

/** Cash received for a delivered COD order (`cod_pending` -> `cod_collected`). */
export async function markCodCollected(
  db: DbClient,
  orderId: string,
  actor: AdminActor,
): Promise<OrderMutationResult> {
  assertCan(actor.role, "order:mark_cod_collected");
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.paymentMethod !== "cod") throw new AdminInputError("Only cash-on-delivery orders collect cash.");
    if (order.status === "cancelled" || order.status === "expired") {
      throw new AdminInputError(`A ${label(order.status)} order has no cash to collect.`);
    }
    if (order.paymentStatus === "cod_collected") throw new AdminInputError("The cash is already marked as collected.");
    if (order.fulfillmentStatus !== "delivered") {
      throw new AdminInputError("Mark the order delivered before marking the cash as collected.");
    }
    step("payment", order.paymentStatus, "cod_collected");
    await tx
      .update(orders)
      .set({ paymentStatus: "cod_collected", paidAt: new Date() })
      .where(eq(orders.id, orderId));
    await addOrderEvent(tx, orderId, {
      type: "cod_collected",
      from: order.paymentStatus,
      to: "cod_collected",
      note: `Cash of ${formatINR(order.totalPaise)} collected on delivery.`,
      visible: true,
      actorId: actor.id,
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "order.cod_collected",
      entity: "order",
      entityId: orderId,
      diff: { ref: order.ref, totalPaise: order.totalPaise },
      ip: actor.ip,
    });
    return { orderId, productIds: [] };
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Cancel                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export const cancelInputSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(300),
  /** Put the units back on the shelf (default yes). */
  restock: z.boolean().optional(),
});

export interface CancelResult extends OrderMutationResult {
  /** Prepaid orders: the refund started for the money taken. */
  refund: { refundId: string; status: string; amountPaise: number } | null;
  /** Set when the order was cancelled but the refund could not be started (retry from the order). */
  refundError: string | null;
}

/**
 * Admin cancel (owner/admin), before dispatch only. One transaction: status, stock (units back via
 * `cancel_restock`, or the checkout reservation released if payment never came), coupon, timeline,
 * audit and the customer e-mail. Prepaid orders are then refunded in full for what is still
 * refundable (a separate step, after commit: the refund calls the payment provider); COD is cancel
 * only. If the refund cannot start, the order stays cancelled and the result says so.
 */
export async function cancelOrder(
  db: DbClient,
  orderId: string,
  raw: unknown,
  actor: AdminActor,
  provider?: PaymentProvider,
): Promise<CancelResult> {
  assertCan(actor.role, "order:cancel");
  const input = cancelInputSchema.parse(raw);

  const phase1 = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!["pending_payment", "confirmed", "processing"].includes(order.status)) {
      throw new AdminInputError(`A ${label(order.status)} order can't be cancelled.`);
    }
    if (order.fulfillmentStatus !== "unfulfilled" && order.fulfillmentStatus !== "packed") {
      throw new AdminInputError(
        `This order is already ${label(order.fulfillmentStatus)}; it can no longer be cancelled. Use the return flow instead.`,
      );
    }
    step("status", order.status, "cancelled");
    const wasPending = order.status === "pending_payment";
    const set: Partial<typeof orders.$inferInsert> = { status: "cancelled", cancelledAt: new Date() };
    if (order.paymentStatus === "cod_pending") {
      step("payment", "cod_pending", "failed");
      set.paymentStatus = "failed";
    }
    await tx.update(orders).set(set).where(eq(orders.id, orderId));

    let productIds: string[] = [];
    if (wasPending) {
      await tx
        .update(stockReservations)
        .set({ status: "released" })
        .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active")));
    } else if (input.restock !== false) {
      productIds = await restockRemaining(tx, order, "cancel_restock", actor.id);
    }
    await releaseRedemption(tx, orderId);

    await addOrderEvent(tx, orderId, {
      type: "order_cancelled",
      from: order.status,
      to: "cancelled",
      note: "Your order was cancelled.",
      visible: true,
      actorId: actor.id,
    });
    await addOrderEvent(tx, orderId, {
      type: "cancel_reason",
      note: `Cancelled by staff: ${input.reason}`,
      actorId: actor.id,
    });
    if (set.paymentStatus) {
      await addOrderEvent(tx, orderId, {
        type: "payment_status_changed",
        from: order.paymentStatus,
        to: set.paymentStatus,
        note: "Order cancelled before any cash was collected.",
        actorId: actor.id,
      });
    }
    // Only orders the customer had been told about get a cancellation e-mail.
    if (!wasPending) {
      await enqueueCustomerNotification(tx, {
        orderId,
        template: "order_cancelled",
        to: order.email,
        payload: notificationPayload("order_cancelled", order, undefined),
      });
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: "order.cancel",
      entity: "order",
      entityId: orderId,
      diff: { ref: order.ref, from: order.status, reason: input.reason, restocked: !wasPending && input.restock !== false },
      ip: actor.ip,
    });

    let refundablePaise = 0;
    if (order.paymentMethod === "razorpay" && (order.paymentStatus === "paid" || order.paymentStatus === "partially_refunded")) {
      const totals = await loadRefundTotals(tx, order);
      refundablePaise = refundableAmount(totals.capturedPaise, totals.committedPaise);
    }
    return { order, productIds, refundablePaise };
  });

  const result: CancelResult = { orderId, productIds: phase1.productIds, refund: null, refundError: null };
  if (phase1.refundablePaise > 0) {
    try {
      const r = await createRefund(
        db,
        {
          orderId,
          amountPaise: phase1.refundablePaise,
          reason: `Order cancelled: ${input.reason}`,
          actorId: actor.id,
        },
        provider,
      );
      if (r.ok) {
        result.refund = { refundId: r.refundId, status: r.status, amountPaise: phase1.refundablePaise };
        if (r.providerError) result.refundError = `The payment provider did not accept the refund yet (${r.providerError}). It will be retried automatically.`;
      } else {
        result.refundError = r.message;
      }
    } catch (e) {
      result.refundError = e instanceof Error ? e.message : "The refund could not be started.";
    }
    if (result.refundError && !result.refund) {
      await db.transaction(async (tx) => {
        await addOrderEvent(tx, orderId, {
          type: "refund_failed_to_start",
          note: `Automatic refund of ${formatINR(phase1.refundablePaise)} on cancellation did not start: ${result.refundError}`,
          actorId: actor.id,
        });
      });
    }
  }
  return result;
}

/* ------------------------------------------------------------------------------------------ */
/* Refund                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export const refundInputSchema = z.object({
  amountPaise: z.number().int("Whole paise only").positive("Enter an amount above 0"),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(300),
  /** UPI / bank reference. Required for COD (manual) refunds. */
  reference: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => v || null),
  restock: z
    .array(z.object({ variantId: z.uuid(), qty: z.number().int().positive() }))
    .max(50)
    .default([]),
});

export interface RefundResult extends OrderMutationResult {
  refundId: string;
  status: string;
  providerError: string | null;
}

/** Full or partial refund (owner/admin) through the refunds service; optional per-line restock. */
export async function refundOrder(
  db: DbClient,
  orderId: string,
  raw: unknown,
  actor: AdminActor,
  provider?: PaymentProvider,
): Promise<RefundResult> {
  assertCan(actor.role, "order:refund");
  const input = refundInputSchema.parse(raw);
  const r = await createRefund(
    db,
    {
      orderId,
      amountPaise: input.amountPaise,
      reason: input.reason,
      actorId: actor.id,
      reference: input.reference,
      restockLines: input.restock,
    },
    provider,
  );
  if (!r.ok) {
    if (r.code === "order_not_found") throw new OrderNotFoundError();
    throw new AdminInputError(r.message);
  }
  return {
    orderId,
    productIds: r.productIds,
    refundId: r.refundId,
    status: r.status,
    providerError: r.providerError ?? null,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Notes + resend                                                                             */
/* ------------------------------------------------------------------------------------------ */

export const noteInputSchema = z.object({
  note: z.string().trim().min(1, "Write a note").max(1000),
});

/** Internal note: an `order_events` row that is never shown to the customer. */
export async function addInternalNote(
  db: DbClient,
  orderId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<OrderMutationResult> {
  assertCan(actor.role, "order:note");
  const input = noteInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    await addOrderEvent(tx, orderId, { type: "note", note: input.note, visible: false, actorId: actor.id });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "order.note",
      entity: "order",
      entityId: orderId,
      diff: { ref: order.ref, length: input.note.length },
      ip: actor.ip,
    });
    return { orderId, productIds: [] };
  });
}

export const resendInputSchema = z.object({
  template: z.enum(["order_confirmed", "order_shipped", "order_delivered", "order_cancelled"]),
});

/** Re-enqueues a customer e-mail for the order's current state (a new outbox row; sending is async). */
export async function resendNotification(
  db: DbClient,
  orderId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<OrderMutationResult & { template: NotificationTemplate }> {
  assertCan(actor.role, "order:resend_notification");
  const input = resendInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    const [shipment] = await tx
      .select()
      .from(shipments)
      .where(eq(shipments.orderId, orderId))
      .orderBy(desc(shipments.createdAt))
      .limit(1);
    const actions = orderActions(order, { refundablePaise: 0, hasShipment: Boolean(shipment) });
    if (!actions.resend.includes(input.template)) {
      throw new AdminInputError(`The "${label(input.template)}" e-mail doesn't apply to this order right now.`);
    }
    await enqueueNotification(tx, {
      orderId,
      template: input.template,
      to: order.email,
      payload: notificationPayload(input.template, order, shipment, { resent: true }),
    });
    await addOrderEvent(tx, orderId, {
      type: "notification_resent",
      note: `Re-sent the "${label(input.template)}" e-mail to ${order.email}.`,
      actorId: actor.id,
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "order.resend_notification",
      entity: "order",
      entityId: orderId,
      diff: { ref: order.ref, template: input.template },
      ip: actor.ip,
    });
    return { orderId, productIds: [], template: input.template };
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Packing slip                                                                               */
/* ------------------------------------------------------------------------------------------ */

export interface PackingSlip {
  ref: string;
  placedAt: Date;
  paymentMethod: PaymentMethod;
  address: Record<string, string | null>;
  items: { productName: string; variantTitle: string; sku: string; qty: number }[];
  shipment: { courier: string; awb: string | null } | null;
}

/** Everything the packing slip prints: NO prices, no payment details (plan 11 / fulfilment role). */
export async function getPackingSlip(db: DbClient, orderId: string, actor: Pick<AdminActor, "role">): Promise<PackingSlip | null> {
  assertCan(actor.role, "order:packing_slip");
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;
  const [items, [shipment]] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.createdAt), asc(orderItems.id)),
    db.select().from(shipments).where(eq(shipments.orderId, orderId)).orderBy(desc(shipments.createdAt)).limit(1),
  ]);
  const raw = (order.shippingAddress ?? {}) as Record<string, unknown>;
  const address: Record<string, string | null> = {};
  for (const key of ["name", "phone", "line1", "line2", "landmark", "city", "state", "pincode"]) {
    const v = raw[key];
    address[key] = typeof v === "string" && v.trim() ? v : null;
  }
  return {
    ref: order.ref,
    placedAt: order.placedAt,
    paymentMethod: order.paymentMethod,
    address,
    items: items.map((i) => ({ productName: i.productName, variantTitle: i.variantTitle, sku: i.sku, qty: i.qty })),
    shipment: shipment ? { courier: shipment.courier, awb: shipment.awb } : null,
  };
}
