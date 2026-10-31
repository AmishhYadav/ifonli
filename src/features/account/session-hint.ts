import "server-only";

import { cookies } from "next/headers";

/**
 * A readable "this browser has a customer session" hint. The real session cookie is httpOnly and the
 * storefront shell is static, so the browser cannot tell whether to run the wishlist sync. This
 * cookie carries no personal data and no authority (the sync Server Actions check the real session);
 * it only saves guests a pointless request on every page load. Name mirrored in
 * `WishlistAccountSync.tsx` (client).
 */
export const ACCOUNT_HINT_COOKIE = "ifonli_acct";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Server Actions / Route Handlers only. */
export async function setAccountHint(): Promise<void> {
  (await cookies()).set(ACCOUNT_HINT_COOKIE, "1", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearAccountHint(): Promise<void> {
  (await cookies()).delete(ACCOUNT_HINT_COOKIE);
}
