import { clearAccountHint, hasAccountHint } from "@/features/account/hint";

import { pullAccountWishlist, pushAccountWishlist } from "./account-actions";
import { mergeIntoWishlist } from "./store";
import { registerWishlistSync, type WishlistSync } from "./sync";

/** Raised by the sync adapter when the server says the session is gone. */
export class SignedOutError extends Error {
  constructor() {
    super("signed_out");
    this.name = "SignedOutError";
  }
}

/** `WishlistSync` backed by Server Actions over the `wishlist_items` table. */
export const accountWishlistSync: WishlistSync = {
  async pull() {
    const res = await pullAccountWishlist();
    if (res.ok) return res.entries;
    if (!res.signedIn) throw new SignedOutError();
    throw new Error("wishlist pull failed");
  },
  async push(entries) {
    const res = await pushAccountWishlist(entries);
    if (!res.ok && !res.signedIn) {
      goDeviceOnly();
      throw new SignedOutError();
    }
    if (!res.ok) throw new Error("wishlist push failed");
  },
};

/** Back to a device-only wishlist (sign-out, expired session, deleted account). */
export function goDeviceOnly(): void {
  registerWishlistSync(null);
  clearAccountHint();
  try {
    sessionStorage.removeItem(SYNCED_FLAG);
  } catch {
    // best effort
  }
}

/** Set once this browser session has reconciled the device list with the account. */
const SYNCED_FLAG = "ifonli_wl_synced";

/**
 * Connects the device list to the account: registers the sync, pulls the account list and merges it
 * into the device list (earliest save time wins). `mergeIntoWishlist` stores the merged list and the
 * registered sync pushes it, so after this call device and account hold the same list.
 */
export async function connectAccountWishlist(): Promise<void> {
  registerWishlistSync(accountWishlistSync);
  try {
    mergeIntoWishlist(await accountWishlistSync.pull());
    try {
      sessionStorage.setItem(SYNCED_FLAG, "1");
    } catch {
      // best effort
    }
  } catch (error) {
    if (error instanceof SignedOutError) goDeviceOnly();
    // Any other failure leaves the sync registered: the next change pushes the whole list anyway.
  }
}

/**
 * Runs on every storefront page load: if the browser has the sign-in hint, re-register the sync and
 * reconcile once per browser session (so a list changed on another device shows up here).
 */
export async function resumeAccountWishlist(): Promise<void> {
  if (!hasAccountHint()) return;
  let done = false;
  try {
    done = sessionStorage.getItem(SYNCED_FLAG) === "1";
  } catch {
    // storage unavailable: reconcile every time, it is idempotent
  }
  if (done) {
    registerWishlistSync(accountWishlistSync);
    return;
  }
  await connectAccountWishlist();
}
