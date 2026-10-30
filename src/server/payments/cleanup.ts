import "server-only";

import { and, isNotNull, lt } from "drizzle-orm";

import { webhookEvents } from "@/server/db/schema";
import { deleteExpiredCarts } from "@/server/services/cart";
import type { DbClient } from "@/server/services/queries/shared";
import { pruneRateLimits } from "@/server/services/rate-limit";

/** Processed webhook events are kept this long for support lookups, then deleted. */
export const WEBHOOK_RETENTION_DAYS = 90;

export async function cleanupHousekeeping(
  db: DbClient,
  now: Date = new Date(),
): Promise<{ cartsDeleted: number; webhookEventsDeleted: number; rateLimitWindowsDeleted: number }> {
  const cartsDeleted = await deleteExpiredCarts(db, now);
  const webhooks = await db
    .delete(webhookEvents)
    .where(
      and(
        isNotNull(webhookEvents.processedAt),
        lt(webhookEvents.processedAt, new Date(now.getTime() - WEBHOOK_RETENTION_DAYS * 86_400_000)),
      ),
    )
    .returning({ id: webhookEvents.id });
  const rateLimitWindowsDeleted = await pruneRateLimits(db, new Date(now.getTime() - 86_400_000));
  return { cartsDeleted, webhookEventsDeleted: webhooks.length, rateLimitWindowsDeleted };
}
