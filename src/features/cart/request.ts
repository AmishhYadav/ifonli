import "server-only";

import { createHash } from "node:crypto";

import { cookies, headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { getSession } from "@/server/auth/session";

/** Name of the httpOnly cookie that holds the opaque cart token. */
export const CART_COOKIE = "cart_token";
const CART_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export async function readCartToken(): Promise<string | null> {
  return (await cookies()).get(CART_COOKIE)?.value ?? null;
}

/** Server Actions / Route Handlers only (cookies cannot be set while rendering). */
export async function writeCartToken(token: string): Promise<void> {
  (await cookies()).set(CART_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE_SECONDS,
  });
}

/** Forgets the cart cookie (sign-out, or a cookie cart that is not this visitor's). Actions / Route Handlers only. */
export async function clearCartToken(): Promise<void> {
  (await cookies()).delete(CART_COOKIE);
}

/** Best-effort client IP for rate-limit keys. */
export async function getRequestIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || "unknown";
}

export interface SessionUser {
  id: string;
  email: string;
}

/** The logged-in customer, or null for guests (also null if auth is not configured). */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    // The shared lookup marks the render request-time (`connection()`) before Better Auth reads the clock.
    const session = await getSession();
    return session ? { id: session.user.id, email: session.user.email } : null;
  } catch (error) {
    // Let Next's own control-flow errors (prerender bail-out) through.
    unstable_rethrow(error);
    return null;
  }
}

/** Short stable digest for rate-limit keys, so secrets such as the cart token are never stored. */
export function keyDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
