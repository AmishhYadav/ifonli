import "server-only";

import { eq, sql } from "drizzle-orm";

import { invoiceCounters, invoices } from "@/server/db/schema";
import { financialYear, formatInvoiceNumber, type ShippingTaxRule } from "@/server/domain";

import { loadCommerceSettings } from "./commerce/settings";
import { addOrderEvent } from "./order-events";
import type { DbClient } from "./queries/shared";
import { readSettings } from "./queries/shared";

/**
 * Next sequential invoice number for the financial year of `now` (`IFO/26-27/000123`).
 *
 * The counter is one row per FY in `invoice_counters`. `INSERT ... ON CONFLICT DO NOTHING` makes the
 * row exist, then `UPDATE ... SET last_number = last_number + 1 RETURNING` takes its row lock, so
 * concurrent finalisations queue on it and each gets a distinct value. The increment lives in the
 * caller's transaction: a rollback gives the number back, so numbers are gapless as well as unique.
 * Call it as late in the transaction as possible to keep the lock short.
 */
export async function nextInvoiceNumber(tx: DbClient, now: Date): Promise<string> {
  const fy = financialYear(now).label;
  await tx.insert(invoiceCounters).values({ financialYear: fy, lastNumber: 0 }).onConflictDoNothing();
  const [row] = await tx
    .update(invoiceCounters)
    .set({ lastNumber: sql`${invoiceCounters.lastNumber} + 1`, updatedAt: now })
    .where(eq(invoiceCounters.financialYear, fy))
    .returning({ n: invoiceCounters.lastNumber });
  return formatInvoiceNumber(row!.n, now);
}

/**
 * The seller and tax data an invoice is built from, frozen when the order is confirmed (plan 7.12):
 * an invoice must show what was true at the sale, not whatever the settings say on the day it is first
 * downloaded. Stored in `invoices.snapshot`; orders invoiced before the column existed have none and
 * fall back to the live settings.
 */
export interface InvoiceSnapshot {
  version: 1;
  seller: { legalName: string; brandName: string; address: string; state: string; gstin: string | null };
  /** Setting labels whose stored value was still a launch placeholder at the time. */
  placeholderFields: string[];
  /** 2-digit GST code of the seller state ("00" when unknown). */
  sellerStateCode: string;
  /** How GST on shipping / the COD fee was worked out. */
  shippingTaxRule: ShippingTaxRule;
}

const PLACEHOLDER_RE = /PLACEHOLDER/i;

/** Reads the current settings into an invoice snapshot (placeholders flagged, never silently blank). */
export async function loadInvoiceSnapshot(tx: DbClient): Promise<InvoiceSnapshot> {
  const [s, commerce] = await Promise.all([
    readSettings(tx, ["legal_name", "brand_name", "registered_address", "state", "gstin"]),
    loadCommerceSettings(tx),
  ]);
  const placeholderFields: string[] = [];
  const stored = (key: "legal_name" | "registered_address" | "state", fieldLabel: string): string => {
    const r = s[key];
    const value = r.value;
    if (r.isPlaceholder || PLACEHOLDER_RE.test(value)) {
      placeholderFields.push(fieldLabel);
      return PLACEHOLDER_RE.test(value) ? value : `PLACEHOLDER - ${value}`;
    }
    return value;
  };
  return {
    version: 1,
    seller: {
      legalName: stored("legal_name", "legal name"),
      brandName: s.brand_name.value,
      address: stored("registered_address", "registered address"),
      state: stored("state", "business state"),
      gstin: s.gstin.value ? s.gstin.value : null,
    },
    placeholderFields,
    sellerStateCode: commerce.tax.sellerStateCode,
    shippingTaxRule: commerce.tax.shippingTaxRule,
  };
}

/**
 * Gives the order its invoice number if it has none yet ("Tax invoice" when `gstin` is set, else
 * "Bill of supply") and freezes the seller / tax data of the invoice. Idempotent. Used by the COD
 * placement path, `finalizePaidOrder`, and as a back-fill by the invoice service.
 */
export async function ensureInvoiceNumber(
  tx: DbClient,
  orderId: string,
  now: Date,
): Promise<{ number: string; created: boolean }> {
  const [existing] = await tx
    .select({ number: invoices.number })
    .from(invoices)
    .where(eq(invoices.orderId, orderId))
    .limit(1);
  if (existing) return { number: existing.number, created: false };
  const snapshot = await loadInvoiceSnapshot(tx);
  const number = await nextInvoiceNumber(tx, now);
  await tx.insert(invoices).values({
    orderId,
    number,
    kind: snapshot.seller.gstin ? "tax_invoice" : "bill_of_supply",
    snapshot,
  });
  await addOrderEvent(tx, orderId, { type: "invoice_assigned", note: number });
  return { number, created: true };
}
