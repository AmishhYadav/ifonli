import { Badge } from "@/components/admin/ui";
import type { FulfillmentStatus, OrderStatus, PaymentStatus } from "@/server/domain/order-state";
import type { PaymentMethod } from "@/server/domain/types";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const STATUS_TONE: Record<OrderStatus, Tone> = {
  pending_payment: "warning",
  confirmed: "info",
  processing: "primary",
  completed: "success",
  cancelled: "danger",
  expired: "neutral",
};
const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  unpaid: "warning",
  paid: "success",
  failed: "danger",
  cod_pending: "warning",
  cod_collected: "success",
  partially_refunded: "info",
  refunded: "neutral",
};
const FULFILMENT_TONE: Record<FulfillmentStatus, Tone> = {
  unfulfilled: "warning",
  packed: "info",
  shipped: "primary",
  out_for_delivery: "primary",
  delivered: "success",
  rto: "danger",
  returned: "danger",
};

const words = (v: string) => {
  const s = v.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{words(status)}</Badge>;
}
export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={PAYMENT_TONE[status]}>{words(status)}</Badge>;
}
export function FulfilmentBadge({ status }: { status: FulfillmentStatus }) {
  return <Badge tone={FULFILMENT_TONE[status]}>{words(status)}</Badge>;
}
export function MethodBadge({ method }: { method: PaymentMethod }) {
  return <Badge tone="neutral">{method === "cod" ? "COD" : "Online"}</Badge>;
}

const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});
const dateOnly = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

/** "31 Oct 2026, 3:48 pm" in IST. */
export function formatDateTime(d: Date): string {
  return dateTime.format(d);
}
export function formatDate(d: Date): string {
  return dateOnly.format(d);
}

export { words as statusWords };
