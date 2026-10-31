import "server-only";

import { cookies } from "next/headers";

import { SESSION_COOKIE, SESSION_ID_PATTERN } from "@/lib/analytics/events";

/**
 * The anonymous analytics session id from the `ifonli_sid` cookie (set by the browser helper), or null.
 * Used only to tie an order to its visit for the funnel; it carries no personal data. Request scope only.
 */
export async function readAnalyticsSessionId(): Promise<string | null> {
  try {
    const value = (await cookies()).get(SESSION_COOKIE)?.value;
    return value && SESSION_ID_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}
