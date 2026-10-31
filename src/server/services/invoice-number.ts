import "server-only";

import { eq, sql } from "drizzle-orm";

import { invoiceCounters, invoices } from "@/server/db/schema";
import { financialYear, formatInvoiceNumber } from "@/server/domain";

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
 * Gives the order its invoice number if it has none yet ("Tax invoice" when `gstin` is set, else
 * "Bill of supply"). Idempotent. Used by the COD placement path and as a back-fill by the invoice
 * service; prepaid orders get theirs in `finalizePaidOrder`.
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
  const { gstin } = await readSettings(tx, ["gstin"]);
  const number = await nextInvoiceNumber(tx, now);
  await tx.insert(invoices).values({
    orderId,
    number,
    kind: gstin.value ? "tax_invoice" : "bill_of_supply",
  });
  await addOrderEvent(tx, orderId, { type: "invoice_assigned", note: number });
  return { number, created: true };
}
