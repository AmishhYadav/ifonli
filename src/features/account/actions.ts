"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { getAuth } from "@/server/auth/auth";
import { getClientIp, requireCustomer } from "@/server/auth/session";
import { getDb } from "@/server/db";
import {
  createAddress,
  deleteAddress,
  deleteCustomerAccount,
  setDefaultAddress,
  updateAddress,
  updateCustomerProfile,
} from "@/server/services/accounts";
import { consumeRateLimit } from "@/server/services/rate-limit";

import { ACCOUNT_HINT_COOKIE } from "./hint";
import { accountAddressSchema, deleteAccountSchema, profileSchema } from "./schema";

export type AccountResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const SERVER_ERROR = "Something went wrong on our side. Please try again.";

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    out[key] ??= issue.message;
  }
  return out;
}

function invalid(error: z.ZodError): AccountResult<never> {
  return {
    ok: false,
    error: error.issues[0]?.message ?? "Please check your input.",
    fieldErrors: fieldErrors(error),
  };
}

/** Every action re-checks the real session (the proxy only looks for a cookie). */
async function owner() {
  return (await requireCustomer({ denied: "throw" })).user;
}

async function guard<T>(run: () => Promise<AccountResult<T>>): Promise<AccountResult<T>> {
  try {
    return await run();
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof Error && (e.name === "UnauthorizedError" || e.name === "ForbiddenError")) {
      return { ok: false, error: "Please sign in again to continue." };
    }
    console.error("account action failed", e instanceof Error ? e.message : "unknown");
    return { ok: false, error: SERVER_ERROR };
  }
}

export async function saveProfile(input: unknown): Promise<AccountResult> {
  return guard(async () => {
    const me = await owner();
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await updateCustomerProfile(getDb(), me.id, parsed.data);
    revalidatePath("/account", "layout");
    return { ok: true, data: undefined };
  });
}

export async function saveAddress(input: unknown): Promise<AccountResult<{ id: string }>> {
  return guard(async () => {
    const me = await owner();
    const raw = (input ?? {}) as { id?: unknown };
    const parsed = accountAddressSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const db = getDb();
    const result =
      typeof raw.id === "string" && raw.id
        ? await updateAddress(db, me.id, raw.id, parsed.data)
        : await createAddress(db, me.id, parsed.data);
    if (!result.ok) {
      return {
        ok: false,
        error: result.message,
        ...(result.code === "invalid_state" ? { fieldErrors: { state: result.message } } : {}),
      };
    }
    revalidatePath("/account/addresses");
    return { ok: true, data: { id: result.address.id } };
  });
}

export async function makeAddressDefault(addressId: unknown): Promise<AccountResult> {
  return guard(async () => {
    const me = await owner();
    const id = z.uuid().safeParse(addressId);
    if (!id.success) return { ok: false, error: "We couldn't find that address." };
    const result = await setDefaultAddress(getDb(), me.id, id.data);
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/account/addresses");
    return { ok: true, data: undefined };
  });
}

export async function removeAddress(addressId: unknown): Promise<AccountResult> {
  return guard(async () => {
    const me = await owner();
    const id = z.uuid().safeParse(addressId);
    if (!id.success) return { ok: false, error: "We couldn't find that address." };
    const removed = await deleteAddress(getDb(), me.id, id.data);
    if (!removed) return { ok: false, error: "We couldn't find that address." };
    revalidatePath("/account/addresses");
    return { ok: true, data: undefined };
  });
}

/**
 * Deletes the account after the word DELETE is typed. Sessions are revoked by the deletion itself;
 * `signOut` then clears the browser's cookies (and tolerates the session already being gone). The
 * client moves on to the home page afterwards.
 */
export async function deleteMyAccount(input: unknown): Promise<AccountResult> {
  const result = await guard(async () => {
    const me = await owner();
    const parsed = deleteAccountSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const db = getDb();
    const limit = await consumeRateLimit(db, `account-delete:user:${me.id}`, {
      limit: 5,
      windowSeconds: 3600,
    });
    if (!limit.allowed) return { ok: false, error: "Too many attempts. Please try again later." };
    const done = await deleteCustomerAccount(db, me.id, { ip: await getClientIp() });
    if (!done.ok) return { ok: false, error: "We couldn't delete this account." };
    return { ok: true, data: undefined };
  });
  if (!result.ok) return result;

  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch {
    // The session row is already gone; the cookies are cleared below.
  }
  (await cookies()).delete(ACCOUNT_HINT_COOKIE);
  return result;
}
