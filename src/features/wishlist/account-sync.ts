import { mergeIntoWishlist, replaceWishlistLocal, clearWishlistLocal } from "./store";
import { registerWishlistSync, type WishlistSync } from "./sync";
import { pullWishlistAction, pushWishlistAction } from "./sync-actions";

/**
 * Browser side of the account wishlist (D-20). `bootAccountWishlist` runs when the page loads with the
 * "customer session" hint cookie; `endAccountWishlist` runs when the customer signs out.
 *
 *  - First time this device meets this account: UNION of the device list and the account list (a guest's
 *    hearts are never lost on sign-in), pushed back so both sides hold it.
 *  - Every later load: the account list is the source of truth and the device follows it, so a heart
 *    removed on another device does not come back.
 *  - From then on every local change is pushed (`set` in the store calls the registered sync).
 */

export const ACCOUNT_HINT_COOKIE = "ifonli_acct"; // keep in sync with features/account/session-hint.ts
const MARKER_KEY = "ifonli_wishlist_account_v1";

function readMarker(): string | null {
  try {
    return globalThis.localStorage?.getItem(MARKER_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeMarker(userId: string | null): void {
  try {
    if (userId) globalThis.localStorage?.setItem(MARKER_KEY, userId);
    else globalThis.localStorage?.removeItem(MARKER_KEY);
  } catch {
    // Storage blocked: the merge simply repeats next load (a union is safe to repeat).
  }
}

export function hasAccountHint(): boolean {
  return typeof document !== "undefined" && document.cookie.split("; ").some((c) => c.startsWith(`${ACCOUNT_HINT_COOKIE}=`));
}

function dropAccountHint(): void {
  document.cookie = `${ACCOUNT_HINT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}

export function createAccountWishlistSync(): WishlistSync {
  return {
    async pull() {
      const res = await pullWishlistAction();
      return res.signedIn ? res.entries : [];
    },
    async push(entries) {
      const res = await pushWishlistAction(entries);
      if (!res.signedIn) {
        // The session ended somewhere else: go back to device-only.
        registerWishlistSync(null);
        dropAccountHint();
      }
    },
  };
}

/** Returns true when a customer session was found and the sync is running. */
export async function bootAccountWishlist(): Promise<boolean> {
  const res = await pullWishlistAction();
  if (!res.signedIn) {
    registerWishlistSync(null);
    dropAccountHint();
    return false;
  }
  registerWishlistSync(createAccountWishlistSync());
  if (readMarker() !== res.userId) {
    // `mergeIntoWishlist` unions and pushes the result through the registered sync.
    mergeIntoWishlist(res.entries);
    writeMarker(res.userId);
  } else {
    replaceWishlistLocal(res.entries);
  }
  return true;
}

/** Sign-out on this device: stop syncing and leave nothing of the account's list behind. */
export function endAccountWishlist(): void {
  registerWishlistSync(null);
  writeMarker(null);
  clearWishlistLocal();
  dropAccountHint();
}
