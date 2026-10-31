import "server-only";

import { enqueueAdminAlert } from "./outbox";
import { listLowStock } from "@/server/services/inventory";
import type { DbClient } from "@/server/services/queries/shared";

/** Rows listed in the e-mail; the rest are counted ("and N more"). */
export const LOW_STOCK_DIGEST_ROWS = 100;

/**
 * Daily digest of low and sold-out variants for the admin alert recipients. Queues one outbox row per
 * recipient (so delivery gets the same retries as every other e-mail) and returns how many variants
 * it covers; nothing is queued when there is nothing to report.
 */
export async function queueLowStockDigest(db: DbClient, opts: { now?: Date } = {}): Promise<{ variants: number; recipients: number }> {
  const low = await listLowStock(db, { now: opts.now });
  if (low.length === 0) return { variants: 0, recipients: 0 };
  const rows = low.slice(0, LOW_STOCK_DIGEST_ROWS).map((r) => ({
    sku: r.sku,
    productName: r.productName,
    variantTitle: r.variantTitle === "Default" ? "" : r.variantTitle,
    available: r.available,
    threshold: r.threshold,
  }));
  const recipients = await db.transaction((tx) => enqueueAdminAlert(tx, { template: "low_stock_digest", payload: { total: low.length, rows } }));
  return { variants: low.length, recipients };
}
