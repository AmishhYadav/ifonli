import "server-only";

import { and, eq, gte } from "drizzle-orm";

import { adminAuditLog, user } from "@/server/db/schema";
import { dispatchOutboxSoon } from "@/server/notify/dispatch";
import { enqueueNotification } from "@/server/notify/outbox";
import { writeAudit } from "@/server/services/audit";
import { readSettings, type DbClient } from "@/server/services/queries/shared";

import { mergeRecipients, truncateUserAgent } from "./alert-helpers";
import { isAdminRole } from "./permissions";

/** A sign-in from an address with no completed `admin.login` in this many days counts as new. */
export const NEW_SIGN_IN_WINDOW_DAYS = 30;

const DAY_MS = 24 * 3600 * 1000;

/** The address `admin_alert_emails` (the owners' alert list) currently holds. */
async function alertListEmails(db: DbClient): Promise<string[]> {
  const { admin_alert_emails } = await readSettings(db, ["admin_alert_emails"]);
  return admin_alert_emails.value;
}

/**
 * Has `userId` completed an admin sign-in (`admin.login` audit row, written only after the
 * authenticator code) from `ip` within the window? Call it BEFORE writing the audit row of the
 * sign-in being judged. A missing address is never "known", so a request we cannot place still alerts.
 */
export async function isKnownSignInIp(
  db: DbClient,
  userId: string,
  ip: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  if (!ip) return false;
  const since = new Date(now.getTime() - NEW_SIGN_IN_WINDOW_DAYS * DAY_MS);
  const [row] = await db
    .select({ id: adminAuditLog.id })
    .from(adminAuditLog)
    .where(
      and(
        eq(adminAuditLog.actorId, userId),
        eq(adminAuditLog.action, "admin.login"),
        eq(adminAuditLog.ip, ip),
        gte(adminAuditLog.createdAt, since),
      ),
    )
    .limit(1);
  return !!row;
}

export interface NewSignInInput {
  userId: string;
  email: string;
  role: string;
  ip: string | null;
  userAgent: string | null;
  now?: Date;
}

/**
 * "New sign-in to your admin account": queued for the account holder, and also for the owners'
 * alert list when the account is an owner's. NEVER throws and never blocks the sign-in: the
 * sign-in has already succeeded, so a failure here (database, settings, outbox) is logged by error
 * name only and swallowed. Returns whether an alert was queued.
 */
export async function alertOnNewSignIn(db: DbClient, input: NewSignInInput): Promise<boolean> {
  try {
    const now = input.now ?? new Date();
    if (await isKnownSignInIp(db, input.userId, input.ip, now)) return false;
    const recipients = mergeRecipients(
      [input.email],
      input.role === "owner" ? await alertListEmails(db) : [],
    );
    const payload = {
      account: input.email,
      role: input.role,
      at: now.toISOString(),
      ip: input.ip,
      userAgent: truncateUserAgent(input.userAgent),
    };
    await db.transaction(async (tx) => {
      for (const to of recipients) await enqueueNotification(tx, { template: "admin_new_sign_in", to, payload });
    });
    dispatchOutboxSoon();
    return true;
  } catch (error) {
    console.error("new sign-in alert failed:", error instanceof Error ? error.name : "unknown");
    return false;
  }
}

export interface LoginLockedInput {
  /** Normalised (trimmed, lower-cased) e-mail the wrong passwords were tried for. */
  email: string;
  ip: string | null;
  /** `address`: only `ip` is locked out of the account; `account`: the account is locked everywhere. */
  scope: "account" | "address";
  failures: number;
  lockedUntil: Date;
  now?: Date;
}

/**
 * Called once per lock window when an e-mail reaches the daily failed-password budget. Only an
 * existing admin-role account gets anything: an audit row (`admin.login_locked`) and one e-mail to
 * the owners' alert list plus the account's own address. For an address that is not an admin
 * account nothing is written or sent: anyone can type any address into the form, and alerting on
 * that would let a stranger flood the owners' inbox (20 wrong passwords per made-up address).
 * Never throws (see `alertOnNewSignIn`). Returns whether an alert was queued.
 */
export async function alertOnLoginLocked(db: DbClient, input: LoginLockedInput): Promise<boolean> {
  try {
    const [account] = await db
      .select({ id: user.id, email: user.email, role: user.role })
      .from(user)
      .where(eq(user.email, input.email));
    if (!account || !isAdminRole(account.role)) return false;
    const now = input.now ?? new Date();
    const recipients = mergeRecipients(await alertListEmails(db), [account.email]);
    const payload = {
      account: account.email,
      scope: input.scope,
      failures: input.failures,
      at: now.toISOString(),
      lockedUntil: input.lockedUntil.toISOString(),
      ip: input.ip,
    };
    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        actorId: null,
        action: "admin.login_locked",
        entity: "user",
        entityId: account.id,
        diff: { scope: input.scope, failures: input.failures, lockedUntil: payload.lockedUntil },
        ip: input.ip,
      });
      for (const to of recipients) await enqueueNotification(tx, { template: "admin_login_locked", to, payload });
    });
    dispatchOutboxSoon();
    return true;
  } catch (error) {
    console.error("login lock alert failed:", error instanceof Error ? error.name : "unknown");
    return false;
  }
}
