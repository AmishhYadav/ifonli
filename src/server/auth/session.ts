import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getAuth } from "./auth";
import {
  assertCan,
  can,
  isAdminRole,
  type Action,
  type Permission,
  type Resource,
  type Role,
} from "./permissions";

/** The slice of a Better Auth session the admin needs. */
export interface AdminSession {
  user: {
    id: string;
    name: string;
    email: string;
    role: Role;
    twoFactorEnabled: boolean;
  };
}

export class UnauthorizedError extends Error {
  constructor(message = "Sign in required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Current Better Auth session (or null). Memoised per request. */
export const getSession = cache(async () => {
  // Session lookup compares expiry against the clock (`new Date()`), which Cache Components only
  // allows once the render is request-time: `connection()` marks it so for every caller, including
  // pages validated on their own.
  await connection();
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

/** Narrow the raw session to an `AdminSession`, or null if it is not an admin-role account. */
async function getAdminCandidate(): Promise<AdminSession | null> {
  const session = await getSession();
  if (!session) return null;
  const u = session.user as typeof session.user & {
    role?: string;
    twoFactorEnabled?: boolean | null;
  };
  if (!isAdminRole(u.role)) return null;
  return {
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      twoFactorEnabled: u.twoFactorEnabled === true,
    },
  };
}

/**
 * Admin gate for layouts, pages and Server Actions (the proxy is only a coarse cookie check).
 *
 * - no session, or a non-admin role: redirect to /admin/login;
 * - admin without TOTP enrolled: redirect to /admin/enroll-2fa (forced on first login);
 * - with a `permission`, a role that lacks it is redirected to /admin/forbidden, or (Server
 *   Actions: `{ denied: "throw" }`) gets a `ForbiddenError`.
 */
export async function requireAdmin(
  permission?: Permission,
  opts: { denied?: "redirect" | "throw" } = {},
): Promise<AdminSession> {
  const session = await getAdminCandidate();
  if (!session) redirect("/admin/login");
  if (!session.user.twoFactorEnabled) redirect("/admin/enroll-2fa");
  if (permission && !can(session.user.role, permission)) {
    if (opts.denied === "throw") throw new ForbiddenError();
    redirect("/admin/forbidden");
  }
  return session;
}

/** For Server Actions of the enrolment flow: an admin-role session that has NOT enrolled TOTP yet. */
export async function requireEnrolling(): Promise<AdminSession> {
  const session = await getAdminCandidate();
  if (!session) redirect("/admin/login");
  if (session.user.twoFactorEnabled) redirect("/admin");
  return session;
}

/**
 * For the /admin/enroll-2fa page: the admin-role session if there is one (null otherwise).
 * The page must not redirect on its own: finishing enrolment rotates the session, and the page
 * re-renders as part of that same Server Action response, where the request still carries the old
 * (just revoked) cookie. A redirect there would skip the backup-codes screen. The proxy already
 * sends cookie-less visitors to login and every enrolment action re-checks the session.
 */
export async function getEnrollmentSession(): Promise<AdminSession | null> {
  return getAdminCandidate();
}

/** Throws `ForbiddenError` unless the session's role may do `action` on `resource`. */
export function assertPermission<R extends Resource>(
  session: AdminSession,
  resource: R,
  action: Action<R>,
): void {
  try {
    assertCan(session.user.role, `${resource}:${action}` as Permission);
  } catch {
    throw new ForbiddenError();
  }
}

/** The slice of a Better Auth session the customer account needs. */
export interface CustomerSession {
  user: { id: string; name: string; email: string };
}

/** Where an admin-role session that opens /account is sent (a short notice, no customer data). */
export const ADMIN_SESSION_NOTICE_PATH = "/account/admin-session";

/**
 * Customer gate for the /account layout, pages and Server Actions (the proxy is only a coarse
 * cookie check; this is the real one).
 *
 * - no session: redirect to /account/login (Server Actions: `{ denied: "throw" }` gets an
 *   `UnauthorizedError`);
 * - an admin-role session: redirect to the notice page, or a `ForbiddenError`. Staff accounts have no
 *   customer data and must never be shown any.
 */
export async function requireCustomer(
  opts: { denied?: "redirect" | "throw" } = {},
): Promise<CustomerSession> {
  const session = await getSession();
  if (!session) {
    if (opts.denied === "throw") throw new UnauthorizedError();
    redirect("/account/login");
  }
  const u = session.user as typeof session.user & { role?: string };
  if (isAdminRole(u.role)) {
    if (opts.denied === "throw") throw new ForbiddenError();
    redirect(ADMIN_SESSION_NOTICE_PATH);
  }
  return { user: { id: u.id, name: u.name, email: u.email } };
}

/** Best-effort client IP for audit rows and rate-limit keys. */
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}
