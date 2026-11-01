import "server-only";

import { APIError } from "better-auth/api";

/**
 * True for an error Better Auth threw on purpose (wrong password, bad code, refused by a guard).
 * `instanceof` alone is not enough in `next dev`: after a hot reload the long-lived auth instance
 * (kept on `globalThis`) can hold the previous copy of the `APIError` class, and a failed sign-in
 * would then look like a crash instead of a form error. Matching the name covers both copies.
 */
export function isAuthApiError(error: unknown): error is APIError {
  return error instanceof APIError || (error instanceof Error && error.name === "APIError");
}

/** HTTP status of an auth API error, when it has one. */
export function authErrorStatus(error: unknown): number | null {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" ? status : null;
}
