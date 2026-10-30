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
  return { userId, created };
}
