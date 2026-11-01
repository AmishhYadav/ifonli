import "server-only";

import { and, eq, isNotNull, lt } from "drizzle-orm";

import { notificationOutbox, session, verification, webhookEvents } from "@/server/db/schema";
import { deleteExpiredCarts } from "@/server/services/cart";
import type { DbClient } from "@/server/services/queries/shared";
import { pruneRateLimits } from "@/server/services/rate-limit";

/** Processed webhook events are kept this long for support lookups, then deleted. */
export const WEBHOOK_RETENTION_DAYS = 90;

/** E-mails that were delivered are kept this long (to answer "did you send it?"), then deleted: they hold addresses and names. */
export const SENT_NOTIFICATION_RETENTION_DAYS = 90;

export interface CleanupResult {
  cartsDeleted: number;
  webhookEventsDeleted: number;
  rateLimitWindowsDeleted: number;
  sentNotificationsDeleted: number;
  expiredSessionsDeleted: number;
  expiredVerificationsDeleted: number;
}

export async function cleanupHousekeeping(db: DbClient, now: Date = new Date()): Promise<CleanupResult> {
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
  const notifications = await db
    .delete(notificationOutbox)
    .where(
      and(
        eq(notificationOutbox.status, "sent"),
        lt(notificationOutbox.sentAt, new Date(now.getTime() - SENT_NOTIFICATION_RETENTION_DAYS * 86_400_000)),
      ),
    )
    .returning({ id: notificationOutbox.id });
  // Better Auth never sweeps these itself: signed-out and abandoned sessions, and used-up sign-in codes.
  const sessions = await db.delete(session).where(lt(session.expiresAt, now)).returning({ id: session.id });
  const verifications = await db
    .delete(verification)
    .where(lt(verification.expiresAt, now))
    .returning({ id: verification.id });
  return {
    cartsDeleted,
    webhookEventsDeleted: webhooks.length,
    rateLimitWindowsDeleted,
    sentNotificationsDeleted: notifications.length,
    expiredSessionsDeleted: sessions.length,
    expiredVerificationsDeleted: verifications.length,
  };
}
