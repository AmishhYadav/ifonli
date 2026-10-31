import { formatINR } from "@/lib/money";

/** The slice of an order the status copy reads (kept structural so tests need no database row). */
export interface OrderCopyInput {
  statusLabel:
    | "Payment pending"
    | "Confirmed"
    | "Packed"
    | "Shipped"
    | "Out for delivery"
    | "Delivered"
    | "Cancelled"
    | "Refunded";
  paymentMethod: "razorpay" | "cod";
  paymentStatus: string;
  status: string;
  totalPaise: number;
  email: string;
}

export function headline(order: Pick<OrderCopyInput, "statusLabel">): string {
  switch (order.statusLabel) {
    case "Payment pending":
      return "Complete your payment";
    case "Cancelled":
      return "This order was cancelled";
    case "Refunded":
      return "This order was refunded";
    case "Delivered":
      return "Your order was delivered";
    case "Confirmed":
      return "Thank you, your order is confirmed";
    default:
      return `Your order is ${order.statusLabel.toLowerCase()}`;
  }
}

export function nextSteps(order: Pick<OrderCopyInput, "statusLabel" | "paymentMethod" | "totalPaise" | "email">): string {
  const cod = order.paymentMethod === "cod";
  switch (order.statusLabel) {
    case "Payment pending":
      return "Your items are held for a short time while we wait for the payment.";
    case "Confirmed":
      return cod
        ? `We've received your order. Please keep ${formatINR(order.totalPaise)} ready to pay when it arrives. We'll email updates to ${order.email}.`
        : `We've received your payment. We're getting your order ready and will email updates to ${order.email}.`;
    case "Packed":
      return "Your order is packed and waiting for the courier. You'll get the tracking details by email.";
    case "Shipped":
    case "Out for delivery":
      return "Your order is on its way. You can follow it on the tracking page.";
    case "Delivered":
      return "We hope you like it. If anything is wrong with your order, get in touch and we'll help.";
    case "Cancelled":
      return order.paymentMethod === "razorpay"
        ? "If you were charged for this order, the amount goes back to your original payment method."
        : "You hadn't paid anything for this order, so there's nothing to refund.";
    case "Refunded":
      return "Your refund has been issued to your original payment method. Banks can take a few working days to show it.";
  }
}

export function paymentLine(order: Pick<OrderCopyInput, "paymentMethod" | "paymentStatus" | "status" | "totalPaise">): string {
  if (order.paymentMethod === "cod") {
    switch (order.paymentStatus) {
      case "cod_collected":
        return "Cash on delivery: paid";
      case "failed":
        return "Cash on delivery: not collected";
      case "refunded":
      case "partially_refunded":
        return "Cash on delivery: refunded";
      default:
        return `Cash on delivery: pay ${formatINR(order.totalPaise)} when it arrives`;
    }
  }
  switch (order.paymentStatus) {
    case "paid":
      return "Paid online";
    case "partially_refunded":
      return "Paid online (partly refunded)";
    case "refunded":
      return "Paid online (refunded)";
    default:
      return order.status === "pending_payment"
        ? "Online payment: waiting for payment"
        : "Online payment: not completed";
  }
}
