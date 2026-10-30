/**
 * Order state machine (plan 7.7). Three independent axes, each with a table-driven transition map.
 * Same-state "transitions" are not transitions: callers treat them as no-ops and `canTransition`
 * returns false for them.
 */

export const ORDER_STATUSES = [
  "pending_payment",
  "confirmed",
  "processing",
  "completed",
  "cancelled",
  "expired",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "unpaid",
  "paid",
  "failed",
  "cod_pending",
  "cod_collected",
  "partially_refunded",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const FULFILLMENT_STATUSES = [
  "unfulfilled",
  "packed",
  "shipped",
  "out_for_delivery",
  "delivered",
  "rto",
  "returned",
] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export interface AxisStates {
  status: OrderStatus;
  payment: PaymentStatus;
  fulfillment: FulfillmentStatus;
}
export type OrderAxis = keyof AxisStates;

type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

/**
 * Terminal states: `completed`, `cancelled`, `refunded`, `returned` have no exits.
 * `expired -> confirmed` is the ONE documented exception out of a terminal-looking state: a late
 * Razorpay capture after the reservation expired is re-reserved and finalised (plan 7.6). If stock
 * is gone the order stays `expired` and the payment is refunded instead.
 */
export const STATUS_TRANSITIONS: TransitionTable<OrderStatus> = {
  pending_payment: ["confirmed", "cancelled", "expired"],
  confirmed: ["processing", "cancelled"],
  processing: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  expired: ["confirmed"],
};

/**
 * Notes:
 *  - `failed -> unpaid|paid`: a failed attempt can be retried (same Razorpay order) and succeed.
 *  - `cod_pending -> failed`: COD never collected (refused / RTO / cancelled in transit).
 *  - `paid | cod_collected -> partially_refunded | refunded`; `partially_refunded -> refunded`.
 */
export const PAYMENT_TRANSITIONS: TransitionTable<PaymentStatus> = {
  unpaid: ["paid", "failed"],
  paid: ["partially_refunded", "refunded"],
  failed: ["unpaid", "paid"],
  cod_pending: ["cod_collected", "failed"],
  cod_collected: ["partially_refunded", "refunded"],
  partially_refunded: ["refunded"],
  refunded: [],
};

/**
 * Notes:
 *  - `packed -> unfulfilled` lets staff undo a mis-click before dispatch.
 *  - `delivered -> returned` covers a support-case return after delivery.
 *  - `rto` (return to origin) ends in `returned` once the parcel is back.
 */
export const FULFILLMENT_TRANSITIONS: TransitionTable<FulfillmentStatus> = {
  unfulfilled: ["packed"],
  packed: ["shipped", "unfulfilled"],
  shipped: ["out_for_delivery", "delivered", "rto"],
  out_for_delivery: ["delivered", "rto"],
  delivered: ["returned"],
  rto: ["returned"],
  returned: [],
};

const TABLES: { [A in OrderAxis]: TransitionTable<AxisStates[A]> } = {
  status: STATUS_TRANSITIONS,
  payment: PAYMENT_TRANSITIONS,
  fulfillment: FULFILLMENT_TRANSITIONS,
};

export class OrderTransitionError extends Error {
  override name = "OrderTransitionError";
  constructor(
    readonly axis: OrderAxis,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal ${axis} transition: ${from} -> ${to}`);
  }
}

export function allowedTransitions<A extends OrderAxis>(
  axis: A,
  from: AxisStates[A],
): readonly AxisStates[A][] {
  return (TABLES[axis] as TransitionTable<AxisStates[A]>)[from] ?? [];
}

export function canTransition<A extends OrderAxis>(
  axis: A,
  from: AxisStates[A],
  to: AxisStates[A],
): boolean {
  return allowedTransitions(axis, from).includes(to);
}

export function assertTransition<A extends OrderAxis>(
  axis: A,
  from: AxisStates[A],
  to: AxisStates[A],
): void {
  if (!canTransition(axis, from, to)) {
    throw new OrderTransitionError(axis, from, to);
  }
}

/** A state is terminal when nothing can leave it. */
export function isTerminal<A extends OrderAxis>(axis: A, state: AxisStates[A]): boolean {
  return allowedTransitions(axis, state).length === 0;
}

export interface OrderStateSnapshot {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
}

export type CustomerStatusLabel =
  | "Payment pending"
  | "Confirmed"
  | "Packed"
  | "Shipped"
  | "Out for delivery"
  | "Delivered"
  | "Cancelled"
  | "Refunded";

/**
 * Single customer-facing label from the three axes. Precedence:
 *  1. fully refunded payment -> Refunded
 *  2. cancelled / expired -> Cancelled
 *  3. pending_payment -> Payment pending
 *  4. fulfilment progress (delivered, out for delivery, shipped, packed)
 *     - `rto` shows as Shipped (still with the courier); `returned` shows as Cancelled
 *  5. otherwise Confirmed
 * `partially_refunded` does not change the label.
 */
export function customerStatusLabel(order: OrderStateSnapshot): CustomerStatusLabel {
  if (order.paymentStatus === "refunded") {
    return "Refunded";
  }
  if (order.status === "cancelled" || order.status === "expired") {
    return "Cancelled";
  }
  if (order.status === "pending_payment") {
    return "Payment pending";
  }
  switch (order.fulfillmentStatus) {
    case "delivered":
      return "Delivered";
    case "out_for_delivery":
      return "Out for delivery";
    case "shipped":
    case "rto":
      return "Shipped";
    case "packed":
      return "Packed";
    case "returned":
      return "Cancelled";
    default:
      return order.status === "completed" ? "Delivered" : "Confirmed";
  }
}

const CANCELLABLE_STATUSES: readonly OrderStatus[] = ["pending_payment", "confirmed", "processing"];

/**
 * Customer may cancel while the order can still move to `cancelled` and its fulfilment status is in
 * the owner-configured list (`settings.cancellable_statuses`; placeholder: `unfulfilled`).
 */
export function isCustomerCancellable(
  order: OrderStateSnapshot,
  cancellableFulfillmentStatuses: readonly FulfillmentStatus[],
): boolean {
  return (
    CANCELLABLE_STATUSES.includes(order.status) &&
    order.paymentStatus !== "refunded" &&
    cancellableFulfillmentStatuses.includes(order.fulfillmentStatus)
  );
}

/** `captured - refunded`, never negative. Both must be non-negative integers. */
export function refundableAmount(capturedPaise: number, refundedPaise: number): number {
  if (!Number.isSafeInteger(capturedPaise) || capturedPaise < 0) {
    throw new RangeError(`capturedPaise must be a non-negative integer, got ${capturedPaise}`);
  }
  if (!Number.isSafeInteger(refundedPaise) || refundedPaise < 0) {
    throw new RangeError(`refundedPaise must be a non-negative integer, got ${refundedPaise}`);
  }
  return Math.max(0, capturedPaise - refundedPaise);
}
