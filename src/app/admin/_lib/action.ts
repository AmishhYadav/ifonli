import "server-only";

import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";

import type { Permission } from "@/server/auth/permissions";
import {
  ForbiddenError,
  getClientIp,
  requireAdmin,
  type AdminSession,
} from "@/server/auth/session";
import {
  AdminInputError,
  ProductNotFoundError,
  SkuTakenError,
  SlugTakenError,
  type AdminActor,
} from "@/server/services/admin/products";
import { serverPathToFormPath } from "@/server/services/admin/product-schema";
import {
  InsufficientStockError,
  InvalidStockAdjustmentError,
  VariantNotFoundError,
} from "@/server/services/inventory";

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export interface AdminActionContext {
  session: AdminSession;
  actor: AdminActor;
}

function zodFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = serverPathToFormPath(issue.path.join("."));
    if (path && !(path in out)) out[path] = issue.message;
  }
  return out;
}

/**
 * Runs an admin mutation: re-checks session, admin role, TOTP and `permission` (never trusts the
 * UI or the proxy), builds the audit actor, and turns expected failures into `{ ok: false }`.
 * Redirects (no session / not enrolled) and framework errors are rethrown untouched.
 */
export async function runAdminAction<T>(
  permission: Permission,
  fn: (ctx: AdminActionContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const session = await requireAdmin(permission, { denied: "throw" });
    const actor: AdminActor = {
      id: session.user.id,
      role: session.user.role,
      ip: await getClientIp(),
    };
    return { ok: true, data: await fn({ session, actor }) };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    if (error instanceof ZodError) {
      return { ok: false, error: "Some fields need attention", fieldErrors: zodFieldErrors(error) };
    }
    if (error instanceof SlugTakenError) {
      return { ok: false, error: error.message, fieldErrors: { slug: error.message } };
    }
    if (error instanceof SkuTakenError) return { ok: false, error: error.message };
    if (
      error instanceof AdminInputError ||
      error instanceof ProductNotFoundError ||
      error instanceof InsufficientStockError ||
      error instanceof InvalidStockAdjustmentError ||
      error instanceof VariantNotFoundError
    ) {
      return { ok: false, error: error.message };
    }
    console.error("[admin action]", error);
    return { ok: false, error: "Something went wrong. Nothing was saved; please try again." };
  }
}
