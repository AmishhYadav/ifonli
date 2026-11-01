import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { notificationOutbox } from "@/server/db/schema";

import { enqueueAdminAlert } from "./outbox";
import { listLowStock } from "@/server/services/inventory";
import type { DbClient } from "@/server/services/queries/shared";

/** Rows listed in the e-mail; the rest are counted ("and N more"). */
export const LOW_STOCK_DIGEST_ROWS = 100;

const IST_OFFSET_MS = 5.5 * 3_600_000;

/** Midnight (India time) that starts the India day containing `now`, as a UTC instant. */
function startOfIndiaDay(now: Date): Date {
  const shifted = now.getTime() + IST_OFFSET_MS;
  return new Date(shifted - (shifted % 86_400_000) - IST_OFFSET_MS);
}

/**
 * Daily digest of low and sold-out variants for the admin alert recipients. Queues one outbox row per
 * recipient (so delivery gets the same retries as every other e-mail) and returns how many variants
 * it covers; nothing is queued when there is nothing to report. At most one digest is queued per
 * India day: a cron retry or a second invocation the same day finds the first and does nothing
 * (`alreadyQueued`), so the owners never get it twice.
 */
export async function queueLowStockDigest(
  db: DbClient,
  opts: { now?: Date } = {},
): Promise<{ variants: number; recipients: number; alreadyQueued?: true }> {
  const now = opts.now ?? new Date();
  const low = await listLowStock(db, { now });
  if (low.length === 0) return { variants: 0, recipients: 0 };
  const rows = low.slice(0, LOW_STOCK_DIGEST_ROWS).map((r) => ({
    sku: r.sku,
    productName: r.productName,
    variantTitle: r.variantTitle === "Default" ? "" : r.variantTitle,
    available: r.available,
    threshold: r.threshold,
  }));
  return db.transaction(async (tx) => {
    // Two invocations at once must not both pass the "already queued today" check.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('low-stock-digest'))`);
    const [existing] = await tx
      .select({ id: notificationOutbox.id })
      .from(notificationOutbox)
      .where(and(eq(notificationOutbox.template, "low_stock_digest"), gte(notificationOutbox.createdAt, startOfIndiaDay(now))))
      .limit(1);
    if (existing) return { variants: low.length, recipients: 0, alreadyQueued: true as const };
    const recipients = await enqueueAdminAlert(tx, { template: "low_stock_digest", payload: { total: low.length, rows } });
    return { variants: low.length, recipients };
  });
}
