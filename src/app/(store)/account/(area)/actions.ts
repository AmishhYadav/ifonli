"use server";

import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";

import { clearAccountHint } from "@/features/account/session-hint";
import type { SavedAddress } from "@/features/account/schema";
import { getRequestIp, keyDigest } from "@/features/cart/request";
import { ForbiddenError, UnauthorizedError, requireCustomer } from "@/server/auth/session";
import { getAuth } from "@/server/auth/auth";
import { getDb } from "@/server/db";
import {
  createAddress,
  deleteAddress,
  setDefaultAddress,
  updateAddress,
  updateProfile,
  type AccountResult,
  type CustomerProfile,
} from "@/server/services/account";
import { deleteCustomerAccount } from "@/server/services/dpdp";
import { consumeRateLimit } from "@/server/services/rate-limit";

/**
 * Account Server Actions. Each one re-checks the session (`requireCustomer({ denied: "throw" })`),
 * takes the customer id from it, never from the input, and returns `{ ok: false, ... }` for expected
 * problems so the form can show them next to the field.
 */

export type ActionOutcome<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

const SERVER_ERROR = "Something went wrong on our side. Nothing was saved; please try again.";
const idSchema = z.uuid();

/** Runs `fn` for the signed-in customer; turns the auth errors and surprises into a calm outcome. */
async function asCustomer<T>(
  fn: (userId: string) => Promise<AccountResult<T>>,
): Promise<ActionOutcome<T>> {
  try {
    const { user } = await requireCustomer({ denied: "throw" });
    const res = await fn(user.id);
    if (!res.ok) return { ok: false, message: res.message, fieldErrors: res.fieldErrors };
    refresh();
    return { ok: true, data: res.data };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof UnauthorizedError || e instanceof ForbiddenError) {
      return { ok: false, message: "Please sign in again to continue." };
    }
    console.error("account action failed", e instanceof Error ? e.message : "unknown");
    return { ok: false, message: SERVER_ERROR };
  }
}

export async function saveProfileAction(input: unknown): Promise<ActionOutcome<CustomerProfile>> {
  return asCustomer((userId) => updateProfile(getDb(), userId, input));
}

export async function saveAddressAction(
  addressId: string | null,
  input: unknown,
): Promise<ActionOutcome<SavedAddress>> {
  return asCustomer(async (userId) => {
    if (addressId === null) return createAddress(getDb(), userId, input);
    if (!idSchema.safeParse(addressId).success) {
      return { ok: false, code: "not_found", message: "We couldn't find that address." } as const;
    }
    return updateAddress(getDb(), userId, addressId, input);
  });
}

export async function makeDefaultAddressAction(addressId: string): Promise<ActionOutcome<SavedAddress>> {
  return asCustomer(async (userId) =>
    idSchema.safeParse(addressId).success
      ? setDefaultAddress(getDb(), userId, addressId)
      : ({ ok: false, code: "not_found", message: "We couldn't find that address." } as const),
  );
}

export async function removeAddressAction(addressId: string): Promise<ActionOutcome<{ id: string }>> {
  return asCustomer(async (userId) =>
    idSchema.safeParse(addressId).success
      ? deleteAddress(getDb(), userId, addressId)
      : ({ ok: false, code: "not_found", message: "We couldn't find that address." } as const),
  );
}

/** Ends the session on this device. The wishlist cache on the device is cleared by the client first. */
export async function signOutAction(): Promise<void> {
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch (e) {
    unstable_rethrow(e);
    // Already signed out (expired session): nothing to end.
  }
  await clearAccountHint();
  redirect("/");
}

/**
 * "Delete my account" (DPDP). Signs the session out first (so the cookie is cleared by the auth
 * library), then erases the account with `deleteCustomerAccount`; orders are kept as legal records.
 * Rate limited: a deletion cannot be undone.
 */
export async function deleteAccountAction(): Promise<ActionOutcome> {
  let userId: string;
  try {
    userId = (await requireCustomer({ denied: "throw" })).user.id;
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    const db = getDb();
    const ip = await getRequestIp();
    const limit = await consumeRateLimit(db, `account-delete:${keyDigest(userId)}`, {
      limit: 3,
      windowSeconds: 3600,
    });
    if (!limit.allowed) return { ok: false, message: "Too many attempts. Please try again later." };

    const requestHeaders = await headers();
    try {
      await getAuth().api.signOut({ headers: requestHeaders });
    } catch (e) {
      unstable_rethrow(e);
    }
    const result = await deleteCustomerAccount(db, userId, { actor: { id: userId, ip } });
    if (!result.ok) return { ok: false, message: result.message };
    await clearAccountHint();
  } catch (e) {
    unstable_rethrow(e);
    console.error("deleteAccountAction failed", e instanceof Error ? e.message : "unknown");
    return { ok: false, message: SERVER_ERROR };
  }
  redirect("/account/deleted");
}
