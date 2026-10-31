"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { getRequestIp } from "@/features/cart/request";
import { SUPPORT_PHOTO_MAX, type SupportField } from "@/features/orders/support-schema";
import { getOptionalCustomer } from "@/server/auth/session";
import { revalidateStock } from "@/server/cache/revalidate";
import { getDb } from "@/server/db";
import { dispatchOutboxSoon } from "@/server/notify/dispatch";
import { cancelOrderForCustomer, type OrderAccess } from "@/server/services/customer-orders";
import { createSupportCase, prepareSupportPhotoUploads } from "@/server/services/support-cases";

/**
 * Server Actions behind the order page actions (cancel, report a problem). They serve both entrances to
 * an order: the guest `?t=` link (pass `token`) and the signed-in owner (no token; the session decides).
 * Every refusal for "not yours / not found" is the same message, so refs cannot be probed.
 */

const SERVER_ERROR = "Something went wrong on our side. Please try again.";
const NOT_FOUND = "We couldn't find that order.";

const refSchema = z.string().trim().min(1).max(40);
const tokenSchema = z.string().max(128).optional();

/** Who is asking: the token holder, else the signed-in customer (with a verified e-mail), else nobody. */
async function resolveAccess(token: string | undefined): Promise<OrderAccess | null> {
  if (token) return { kind: "token", token };
  const customer = await getOptionalCustomer();
  if (!customer) return null;
  return {
    kind: "account",
    userId: customer.user.id,
    email: customer.user.emailVerified ? customer.user.email : null,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Cancel                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export type CancelActionResult =
  | {
      ok: true;
      alreadyCancelled: boolean;
      prepaid: boolean;
      /** Prepaid: the amount being refunded (paise), if a refund was started. */
      refundPaise: number | null;
      /** The order is cancelled but the refund needs a retry on our side. */
      refundDelayed: boolean;
    }
  | { ok: false; code: string; message: string };

export async function cancelOrderAction(input: {
  ref: string;
  token?: string;
  reason?: string;
}): Promise<CancelActionResult> {
  try {
    const parsed = z
      .object({ ref: refSchema, token: tokenSchema, reason: z.string().max(300).optional() })
      .safeParse(input);
    if (!parsed.success) return { ok: false, code: "invalid", message: NOT_FOUND };
    const access = await resolveAccess(parsed.data.token);
    if (!access) return { ok: false, code: "not_found", message: NOT_FOUND };

    const result = await cancelOrderForCustomer(getDb(), {
      ref: parsed.data.ref,
      access,
      reason: parsed.data.reason,
      ip: await getRequestIp(),
    });
    if (!result.ok) return { ok: false, code: result.code, message: result.message };

    if (result.productIds.length > 0) revalidateStock({ productIds: result.productIds });
    if (!result.alreadyCancelled) dispatchOutboxSoon();
    refresh();
    return {
      ok: true,
      alreadyCancelled: result.alreadyCancelled,
      prepaid: result.paymentMethod === "razorpay",
      refundPaise: result.refund?.amountPaise ?? null,
      refundDelayed: result.refundError !== null,
    };
  } catch (e) {
    unstable_rethrow(e);
    console.error("cancelOrderAction failed", e instanceof Error ? e.message : "unknown");
    return { ok: false, code: "server_error", message: SERVER_ERROR };
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Report a problem                                                                           */
/* ------------------------------------------------------------------------------------------ */

export type PreparePhotosResult =
  | { ok: true; uploads: { path: string; url: string }[] }
  | { ok: false; code: string; message: string };

const filesSchema = z
  .array(z.object({ type: z.string().max(60), size: z.number().int().nonnegative() }))
  .max(SUPPORT_PHOTO_MAX);

/** Signed upload URLs for the photos a customer picked (nothing is stored on an order yet). */
export async function prepareSupportPhotosAction(input: {
  ref: string;
  token?: string;
  files: { type: string; size: number }[];
}): Promise<PreparePhotosResult> {
  try {
    const parsed = z
      .object({ ref: refSchema, token: tokenSchema, files: filesSchema })
      .safeParse(input);
    if (!parsed.success) return { ok: false, code: "invalid", message: "Check the photos and try again." };
    const access = await resolveAccess(parsed.data.token);
    if (!access) return { ok: false, code: "not_found", message: NOT_FOUND };
    const res = await prepareSupportPhotoUploads(getDb(), {
      ref: parsed.data.ref,
      access,
      files: parsed.data.files,
      ip: await getRequestIp(),
    });
    return res.ok ? res : { ok: false, code: res.code, message: res.message };
  } catch (e) {
    unstable_rethrow(e);
    console.error("prepareSupportPhotosAction failed", e instanceof Error ? e.message : "unknown");
    return { ok: false, code: "server_error", message: SERVER_ERROR };
  }
}

export type ReportProblemResult =
  | { ok: true; late: boolean }
  | {
      ok: false;
      code: string;
      message: string;
      fieldErrors?: Partial<Record<SupportField, string>>;
    };

export async function reportProblemAction(input: {
  ref: string;
  token?: string;
  type: string;
  description: string;
  photoPaths: string[];
}): Promise<ReportProblemResult> {
  try {
    const parsed = z.object({ ref: refSchema, token: tokenSchema }).safeParse(input);
    if (!parsed.success) return { ok: false, code: "invalid", message: NOT_FOUND };
    const access = await resolveAccess(parsed.data.token);
    if (!access) return { ok: false, code: "not_found", message: NOT_FOUND };

    const result = await createSupportCase(getDb(), {
      ref: parsed.data.ref,
      access,
      raw: { type: input.type, description: input.description, photoPaths: input.photoPaths },
      ip: await getRequestIp(),
    });
    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message, fieldErrors: result.fieldErrors };
    }
    dispatchOutboxSoon();
    refresh();
    return { ok: true, late: result.late };
  } catch (e) {
    unstable_rethrow(e);
    console.error("reportProblemAction failed", e instanceof Error ? e.message : "unknown");
    return { ok: false, code: "server_error", message: SERVER_ERROR };
  }
}
