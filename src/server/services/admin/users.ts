import "server-only";

import { randomBytes } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  MIN_ADMIN_PASSWORD_LENGTH,
  markPasswordChangeRequired,
  upsertAdminUser,
} from "@/server/auth/admin-user";
import { ADMIN_ROLES, assertCan } from "@/server/auth/permissions";
import { account, session, twoFactor, user } from "@/server/db/schema";
import { staffDisplayEmail, staffDisplayName } from "./staff-display";
import { writeAudit } from "@/server/services/audit";
import type { DbClient } from "@/server/services/queries/shared";

import { AdminInputError, type AdminActor } from "./products";

/**
 * Staff accounts (owner only: `user:*` / `session:*`, which only the owner role holds).
 *
 * Uses the same rows Better Auth reads (`user`, `session`, `account`, `two_factor`), so a role change,
 * ban or revoked session takes effect on the person's next request. Guard rails, all enforced here and
 * not only in the UI:
 *  - nobody changes, bans, signs out or 2FA-resets their own account here;
 *  - the last active owner can never be demoted or banned;
 *  - only existing staff accounts are managed; customers are never promoted by this module;
 *  - passwords are never written to the audit log; a generated temporary password is returned once;
 *  - a password the owner set (new account, password reset) or a reset of 2FA makes the person pick
 *    their own password when they next enrol, and the temporary one expires after a week
 *    (`markPasswordChangeRequired`), so the first person to use it cannot keep the account.
 */

export type StaffRole = (typeof ADMIN_ROLES)[number];

export interface StaffUserRow {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  banned: boolean;
  banReason: string | null;
  twoFactorEnabled: boolean;
  createdAt: Date;
  activeSessions: number;
  lastSignInAt: Date | null;
}

export async function listStaffUsers(
  db: DbClient,
  now: Date = new Date(),
): Promise<StaffUserRow[]> {
  const rows = await db
    .select()
    .from(user)
    .where(inArray(user.role, [...ADMIN_ROLES]))
    .orderBy(asc(user.createdAt), asc(user.email));
  if (rows.length === 0) return [];
  const sessions = await db
    .select({ userId: session.userId, expiresAt: session.expiresAt, createdAt: session.createdAt })
    .from(session)
    .where(
      inArray(
        session.userId,
        rows.map((r) => r.id),
      ),
    );
  const byUser = new Map<string, { active: number; last: Date | null }>();
  for (const s of sessions) {
    const entry = byUser.get(s.userId) ?? { active: 0, last: null };
    if (s.expiresAt > now) entry.active++;
    if (!entry.last || s.createdAt > entry.last) entry.last = s.createdAt;
    byUser.set(s.userId, entry);
  }
  return rows.map((r) => ({
    id: r.id,
    name: staffDisplayName(r.name, r.role),
    email: staffDisplayEmail(r.email, r.role) ?? "",
    role: r.role as StaffRole,
    banned: r.banned === true,
    banReason: r.banReason,
    twoFactorEnabled: r.twoFactorEnabled === true,
    createdAt: r.createdAt,
    activeSessions: Number(byUser.get(r.id)?.active ?? 0),
    lastSignInAt: byUser.get(r.id)?.last ?? null,
  }));
}

const roleSchema = z.enum(ADMIN_ROLES);

export const newStaffSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  role: roleSchema,
  /** Blank = generate one. */
  password: z
    .string()
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine((v) => v === null || v.length >= MIN_ADMIN_PASSWORD_LENGTH, {
      message: `At least ${MIN_ADMIN_PASSWORD_LENGTH} characters`,
    }),
});

export function generateTempPassword(): string {
  return randomBytes(15).toString("base64url");
}

/** Serialises owner-count decisions (two owners demoting each other at once). */
async function lockOwners(tx: DbClient): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('staff-users'))`);
}

async function loadStaff(tx: DbClient, userId: string) {
  const [target] = await tx.select().from(user).where(eq(user.id, userId)).for("update");
  if (!target || !(ADMIN_ROLES as readonly string[]).includes(target.role)) {
    throw new AdminInputError("Staff account not found");
  }
  return target;
}

async function activeOwners(tx: DbClient): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(user)
    .where(and(eq(user.role, "owner"), sql`${user.banned} is not true`));
  return Number(row?.n ?? 0);
}

function notSelf(actor: AdminActor, userId: string, what: string): void {
  if (actor.id === userId) throw new AdminInputError(`You cannot ${what} your own account`);
}

/** Creates a staff account; the temporary password is returned once (never stored in the audit log). */
export async function createStaffUser(
  db: DbClient,
  raw: unknown,
  actor: AdminActor,
): Promise<{ id: string; email: string; tempPassword: string | null }> {
  assertCan(actor.role, "user:create");
  const input = newStaffSchema.parse(raw);
  const password = input.password ?? generateTempPassword();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, input.email));
    if (existing) throw new AdminInputError("An account with that email already exists");
    const { userId } = await upsertAdminUser(tx, {
      email: input.email,
      name: input.name,
      role: input.role,
      password,
      requirePasswordChange: true,
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "user.create",
      entity: "user",
      entityId: userId,
      diff: { email: input.email, name: input.name, role: input.role },
      ip: actor.ip,
    });
    return { id: userId, email: input.email, tempPassword: input.password ? null : password };
  });
}

export async function changeStaffRole(
  db: DbClient,
  userId: string,
  rawRole: unknown,
  actor: AdminActor,
): Promise<void> {
  assertCan(actor.role, "user:set-role");
  const role = roleSchema.parse(rawRole);
  notSelf(actor, userId, "change the role of");
  await db.transaction(async (tx) => {
    await lockOwners(tx);
    const target = await loadStaff(tx, userId);
    if (target.role === role) return;
    if (target.role === "owner" && target.banned !== true && (await activeOwners(tx)) <= 1) {
      throw new AdminInputError("There must always be at least one active owner");
    }
    await tx.update(user).set({ role }).where(eq(user.id, userId));
    // A role change must apply immediately, not at the next sign-in.
    await tx.delete(session).where(eq(session.userId, userId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "user.role",
      entity: "user",
      entityId: userId,
      diff: { email: target.email, role: { from: target.role, to: role } },
      ip: actor.ip,
    });
  });
}

export async function setStaffBanned(
  db: DbClient,
  userId: string,
  banned: boolean,
  reason: string | null,
  actor: AdminActor,
): Promise<void> {
  assertCan(actor.role, "user:ban");
  if (banned) notSelf(actor, userId, "deactivate");
  const cleanReason = reason?.trim() ? reason.trim().slice(0, 300) : null;
  await db.transaction(async (tx) => {
    await lockOwners(tx);
    const target = await loadStaff(tx, userId);
    if ((target.banned === true) === banned) return;
    if (banned && target.role === "owner" && (await activeOwners(tx)) <= 1) {
      throw new AdminInputError("There must always be at least one active owner");
    }
    await tx
      .update(user)
      .set({ banned, banReason: banned ? cleanReason : null, banExpires: null })
      .where(eq(user.id, userId));
    if (banned) await tx.delete(session).where(eq(session.userId, userId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: banned ? "user.ban" : "user.unban",
      entity: "user",
      entityId: userId,
      diff: { email: target.email, ...(banned ? { reason: cleanReason } : {}) },
      ip: actor.ip,
    });
  });
}

/** Signs the person out everywhere. Returns how many sessions were removed. */
export async function revokeStaffSessions(
  db: DbClient,
  userId: string,
  actor: AdminActor,
): Promise<{ revoked: number }> {
  assertCan(actor.role, "session:revoke");
  notSelf(actor, userId, "sign out everywhere with this tool for");
  return db.transaction(async (tx) => {
    const target = await loadStaff(tx, userId);
    const removed = await tx
      .delete(session)
      .where(eq(session.userId, userId))
      .returning({ id: session.id });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "user.sessions_revoked",
      entity: "user",
      entityId: userId,
      diff: { email: target.email, revoked: removed.length },
      ip: actor.ip,
    });
    return { revoked: removed.length };
  });
}

/** Lost authenticator: drops the TOTP secret and signs the person out; they re-enrol at next sign-in. */
export async function resetStaffTwoFactor(
  db: DbClient,
  userId: string,
  actor: AdminActor,
): Promise<void> {
  assertCan(actor.role, "user:update");
  notSelf(actor, userId, "reset two-factor for");
  await db.transaction(async (tx) => {
    const target = await loadStaff(tx, userId);
    await tx.delete(twoFactor).where(eq(twoFactor.userId, userId));
    await tx.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, userId));
    await tx.delete(session).where(eq(session.userId, userId));
    // Re-enrolment is the moment to pick a fresh password too (the old one may be what leaked).
    await markPasswordChangeRequired(tx, userId);
    await writeAudit(tx, {
      actorId: actor.id,
      action: "user.reset_2fa",
      entity: "user",
      entityId: userId,
      diff: {
        email: target.email,
        twoFactorEnabled: { from: target.twoFactorEnabled === true, to: false },
      },
      ip: actor.ip,
    });
  });
}

/** Sets a new temporary password (returned once) and signs the person out. */
export async function resetStaffPassword(
  db: DbClient,
  userId: string,
  actor: AdminActor,
): Promise<{ tempPassword: string }> {
  assertCan(actor.role, "user:set-password");
  notSelf(actor, userId, "reset the password of");
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await db.transaction(async (tx) => {
    const target = await loadStaff(tx, userId);
    const credential = and(eq(account.userId, userId), eq(account.providerId, "credential"));
    const [acct] = await tx.select({ id: account.id }).from(account).where(credential);
    if (acct) {
      await tx.update(account).set({ password: passwordHash }).where(eq(account.id, acct.id));
    } else {
      await tx.insert(account).values({
        id: crypto.randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: passwordHash,
      });
    }
    await tx.delete(session).where(eq(session.userId, userId));
    // An enrolled person still needs their authenticator, so a temporary password alone is no risk and
    // they have no screen to change it on; only someone still to enrol is asked for a new password.
    if (target.twoFactorEnabled !== true) await markPasswordChangeRequired(tx, userId);
    await writeAudit(tx, {
      actorId: actor.id,
      action: "user.reset_password",
      entity: "user",
      entityId: userId,
      diff: { email: target.email },
      ip: actor.ip,
    });
  });
  return { tempPassword };
}
