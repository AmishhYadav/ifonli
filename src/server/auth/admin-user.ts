import "server-only";

import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/server/services/queries/shared";
import { account, twoFactor, user } from "@/server/db/schema";

import { ADMIN_ROLES } from "./permissions";

export const MIN_ADMIN_PASSWORD_LENGTH = 12;

export interface UpsertAdminInput {
  email: string;
  role: (typeof ADMIN_ROLES)[number];
  password: string;
  name?: string;
  /** Delete the TOTP secret and force re-enrolment at next login (lost authenticator). */
  resetTwoFactor?: boolean;
  /**
   * The password is a temporary one the person did not choose: they must set their own during
   * first enrolment, and the temporary one stops working after `TEMP_PASSWORD_TTL_DAYS`.
   */
  requirePasswordChange?: boolean;
}

/** How long a temporary staff password can be used to sign in before an owner must issue a new one. */
export const TEMP_PASSWORD_TTL_DAYS = 7;

export type PasswordChangeState =
  | { state: "none" }
  | { state: "required"; deadline: Date }
  | { state: "expired" };

/**
 * "Must change password": `user.password_change_deadline` holds the date after which the temporary
 * password stops signing in; NULL means nothing is pending. (It used to be a marker row in Better
 * Auth's `verification` table; migration 0005 moved existing ones over.) Only ever set for accounts
 * that have not enrolled TOTP yet, so it cannot lock an active admin out.
 */
export async function markPasswordChangeRequired(
  db: DbClient,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(user)
    .set({ passwordChangeDeadline: new Date(now.getTime() + TEMP_PASSWORD_TTL_DAYS * 24 * 3600 * 1000) })
    .where(eq(user.id, userId));
}

export async function clearPasswordChangeRequired(db: DbClient, userId: string): Promise<void> {
  await db.update(user).set({ passwordChangeDeadline: null }).where(eq(user.id, userId));
}

export async function getPasswordChangeState(
  db: DbClient,
  userId: string,
  now: Date = new Date(),
): Promise<PasswordChangeState> {
  const [row] = await db
    .select({ deadline: user.passwordChangeDeadline })
    .from(user)
    .where(eq(user.id, userId));
  if (!row?.deadline) return { state: "none" };
  if (row.deadline <= now) return { state: "expired" };
  return { state: "required", deadline: row.deadline };
}

export interface UpsertAdminResult {
  userId: string;
  created: boolean;
}

/**
 * Creates or updates an admin account with a credential (password) login. Admins are never created
 * through a public endpoint (D-AUTH-1), so this is used by `scripts/create-admin.ts` and tests.
 * Writes Better Auth's own rows (`user` + a `credential` `account` holding the scrypt hash), so the
 * normal `/sign-in/email` flow and the two-factor challenge work unchanged.
 */
export async function upsertAdminUser(
  db: DbClient,
  input: UpsertAdminInput,
): Promise<UpsertAdminResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Invalid email "${input.email}"`);
  if (!(ADMIN_ROLES as readonly string[]).includes(input.role)) {
    throw new Error(`Role must be one of ${ADMIN_ROLES.join(", ")}`);
  }
  if (input.password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`);
  }
  const passwordHash = await hashPassword(input.password);

  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  let userId: string;
  let created = false;
  if (existing) {
    userId = existing.id;
    await db
      .update(user)
      .set({
        role: input.role,
        emailVerified: true,
        banned: false,
        ...(input.name ? { name: input.name } : {}),
        ...(input.resetTwoFactor ? { twoFactorEnabled: false } : {}),
      })
      .where(eq(user.id, userId));
  } else {
    userId = crypto.randomUUID();
    created = true;
    await db.insert(user).values({
      id: userId,
      name: input.name?.trim() || email.split("@")[0]!,
      email,
      emailVerified: true,
      role: input.role,
    });
  }

  const credential = and(eq(account.userId, userId), eq(account.providerId, "credential"));
  const [acct] = await db.select({ id: account.id }).from(account).where(credential);
  if (acct) {
    await db.update(account).set({ password: passwordHash }).where(eq(account.id, acct.id));
  } else {
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
    });
  }

  if (input.resetTwoFactor) await db.delete(twoFactor).where(eq(twoFactor.userId, userId));
  if (input.requirePasswordChange) await markPasswordChangeRequired(db, userId);
  else await clearPasswordChangeRequired(db, userId);
  return { userId, created };
}
