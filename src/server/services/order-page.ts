import "server-only";

import { reportableTypes, type SupportType } from "@/features/orders/support-schema";

import { customerCancelEligibility, loadCancellableStatuses } from "./customer-orders";
import type { CustomerOrderView } from "./orders";
import type { DbClient } from "./queries/shared";
import { loadClaimWindow, listSupportCasesForOrder, supabaseSupportPhotoStorage } from "./support-cases";
import { estimateOrderDelivery } from "./tracking";

/**
 * Everything the order page needs beyond the order itself, for BOTH entrances (guest `?t=` link and
 * `/account/orders/[ref]`): delivery estimate, whether the customer can cancel, which problems they
 * can report, and the cases they already opened.
 */
export interface OrderPageExtras {
  delivery: { fromDate: string; toDate: string } | null;
  cancel: {
    available: boolean;
    /** Why not, in a sentence, when the order is still open but past the cancellable stage. */
    hint: string | null;
  };
  report: {
    types: SupportType[];
    /** Owner's claim window in hours (0 = none) and whether it has already ended for this order. */
    claimWindowHours: number;
    windowEnded: boolean;
    /** False when photo storage is not configured (local dev): the form hides the photo picker. */
    photosAvailable: boolean;
  };
  cases: { id: string; type: SupportType; status: string; resolution: string | null; createdAt: Date }[];
  /** An invoice exists (or can be rendered) once the order is confirmed. */
  invoiceAvailable: boolean;
}

export async function loadOrderPageExtras(
  db: DbClient,
  order: CustomerOrderView,
  now: Date = new Date(),
): Promise<OrderPageExtras> {
  const open = order.status === "confirmed" || order.status === "processing";
  const [delivery, cancellable, claim, cases] = await Promise.all([
    open && order.fulfillmentStatus !== "delivered"
      ? estimateOrderDelivery(db, order.shippingAddress, order.paidAt ?? order.placedAt)
      : Promise.resolve(null),
    loadCancellableStatuses(db),
    loadClaimWindow(db, order.id, now),
    listSupportCasesForOrder(db, order.id),
  ]);
  const verdict = customerCancelEligibility(order, cancellable);
  return {
    delivery: delivery ? { fromDate: delivery.fromDate, toDate: delivery.toDate } : null,
    cancel: {
      available: verdict.ok,
      hint: !verdict.ok && verdict.code === "in_progress" ? verdict.message : null,
    },
    report: {
      types: reportableTypes(order),
      claimWindowHours: claim.hours,
      windowEnded: claim.late,
      photosAvailable: supabaseSupportPhotoStorage.configured(),
    },
    cases,
    invoiceAvailable: open || order.status === "completed",
  };
}
