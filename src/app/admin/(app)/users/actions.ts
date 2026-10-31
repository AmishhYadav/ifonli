"use server";

import { z } from "zod";

import { runAdminAction, type ActionResult } from "@/app/admin/_lib/action";
import { getDb } from "@/server/db";
import {
  changeStaffRole,
  createStaffUser,
  resetStaffPassword,
  resetStaffTwoFactor,
  revokeStaffSessions,
  setStaffBanned,
} from "@/server/services/admin/users";

// Staff changes never touch the storefront cache. The owner-only permissions are re-checked in the
// service (user:* / session:*), on top of the permission named here.
const idSchema = z.string().min(1).max(100);

export async function createStaffAction(
  input: unknown,
): Promise<ActionResult<{ id: string; email: string; tempPassword: string | null }>> {
  return runAdminAction("user:create", async ({ actor }) => createStaffUser(getDb(), input, actor));
}

export async function changeStaffRoleAction(userId: string, role: string): Promise<ActionResult> {
  return runAdminAction("user:set-role", async ({ actor }) => {
    await changeStaffRole(getDb(), idSchema.parse(userId), role, actor);
    return undefined;
  });
}

export async function setStaffBannedAction(
  userId: string,
  banned: boolean,
  reason?: string,
): Promise<ActionResult> {
  return runAdminAction("user:ban", async ({ actor }) => {
    await setStaffBanned(
      getDb(),
      idSchema.parse(userId),
      z.boolean().parse(banned),
      z.string().max(300).optional().parse(reason) ?? null,
      actor,
    );
    return undefined;
  });
}

export async function revokeStaffSessionsAction(userId: string): Promise<ActionResult<{ revoked: number }>> {
  return runAdminAction("session:revoke", async ({ actor }) =>
    revokeStaffSessions(getDb(), idSchema.parse(userId), actor),
  );
}

export async function resetStaffTwoFactorAction(userId: string): Promise<ActionResult> {
  return runAdminAction("user:update", async ({ actor }) => {
    await resetStaffTwoFactor(getDb(), idSchema.parse(userId), actor);
    return undefined;
  });
}

export async function resetStaffPasswordAction(
  userId: string,
): Promise<ActionResult<{ tempPassword: string }>> {
  return runAdminAction("user:set-password", async ({ actor }) =>
    resetStaffPassword(getDb(), idSchema.parse(userId), actor),
  );
}
