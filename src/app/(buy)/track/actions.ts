"use server";

import { unstable_rethrow } from "next/navigation";

import { getRequestIp, keyDigest } from "@/features/cart/request";
import { captureException } from "@/lib/monitoring/sentry";
import { getDb } from "@/server/db";
import { consumeRateLimit } from "@/server/services/rate-limit";
import { lookupOrderForTracking, parseTrackingContact } from "@/server/services/tracking";

import type { TrackFormState } from "./types";

const NOT_FOUND =
  "We couldn't find that order. Check the order reference and the email or mobile number you used at checkout.";

/** Lookups allowed per contact (normalised e-mail or phone) per 24 h, whoever asks. */
const TRACK_CONTACT_LIMIT = { limit: 15, windowSeconds: 24 * 60 * 60 };

/** "in 5 minutes" up to an hour, "in 20 hours" beyond (the per-contact budget resets daily). */
function waitText(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

const text = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

/**
 * Guest order lookup (plan 7.11): order reference plus the email or mobile used at checkout. Rate limited
 * by IP and by (reference, IP); every mismatch gets the same answer so refs and emails cannot be
 * enumerated. The reference budget is per caller on purpose: a budget shared by everyone would let
 * anyone who knows a reference use it up and lock the real customer out of their own tracking page.
 *
 * Both of those are per caller, so someone who knows a victim's e-mail or phone could spread guesses
 * of the (short) reference across many IPs. A third budget therefore caps the lookups per contact
 * (`TRACK_CONTACT_LIMIT` a day, digest key, counted on every lookup). It is only spent once the
 * per-caller checks have passed, so a single blocked caller cannot burn it.
 */
export async function trackOrder(
  _prev: TrackFormState,
  formData: FormData,
): Promise<TrackFormState> {
  const ref = text(formData.get("ref")).trim().slice(0, 64);
  const contact = text(formData.get("contact")).trim().slice(0, 300);
  const values = { ref, contact };

  const fieldErrors: NonNullable<TrackFormState["fieldErrors"]> = {};
  if (!ref) fieldErrors.ref = "Enter your order reference, like IFO-2611-7K3Q";
  const parsedContact = contact ? parseTrackingContact(contact) : null;
  if (!contact) fieldErrors.contact = "Enter the email or mobile number you used at checkout";
  else if (!parsedContact) {
    fieldErrors.contact = "Enter a valid email address or a 10-digit mobile number";
  }
  if (fieldErrors.ref || fieldErrors.contact) return { status: "invalid", values, fieldErrors };

  try {
    const db = getDb();
    const ip = await getRequestIp();
    const decisions = await Promise.all([
      consumeRateLimit(db, `track:ip:${ip}`, { limit: 20, windowSeconds: 600 }),
      consumeRateLimit(db, `track:ref-ip:${keyDigest(ref.toUpperCase())}:${keyDigest(ip)}`, {
        limit: 8,
        windowSeconds: 600,
      }),
    ]);
    const tooMany = (retryAfterSeconds: number): TrackFormState => ({
      status: "rate_limited",
      values,
      message: `Too many attempts. Please try again in ${waitText(retryAfterSeconds)}.`,
    });
    const blocked = decisions.find((d) => !d.allowed);
    if (blocked) return tooMany(blocked.retryAfterSeconds);

    // Per contact, whoever asks: ref guesses spread over many IPs still hit this one budget. Counted
    // on every lookup (found or not) and keyed by a digest of the normalised contact.
    const byContact = await consumeRateLimit(
      db,
      `track:contact:${keyDigest(parsedContact!.value)}`,
      TRACK_CONTACT_LIMIT,
    );
    if (!byContact.allowed) return tooMany(byContact.retryAfterSeconds);

    const view = await lookupOrderForTracking(db, { ref, emailOrPhone: contact });
    if (!view) return { status: "not_found", values, message: NOT_FOUND };
    return {
      status: "found",
      values,
      order: {
        ref: view.ref,
        statusLabel: view.statusLabel,
        paymentMethod: view.paymentMethod,
        placedAt: view.placedAt.toISOString(),
        totalPaise: view.totalPaise,
        events: view.events.map((e) => ({
          type: e.type,
          note: e.note,
          createdAt: e.createdAt.toISOString(),
        })),
        shipment: view.shipment
          ? {
              courier: view.shipment.courier,
              awb: view.shipment.awb,
              trackingUrl: view.shipment.trackingUrl,
              status: view.shipment.status,
              shippedAt: view.shipment.shippedAt?.toISOString() ?? null,
              deliveredAt: view.shipment.deliveredAt?.toISOString() ?? null,
            }
          : null,
        expectedDelivery: view.expectedDelivery,
        fulfillmentStatus: view.fulfillmentStatus,
      },
    };
  } catch (e) {
    unstable_rethrow(e);
    // Database errors carry the query parameters (the email or phone typed in), so log only the
    // error class and SQLSTATE; the monitoring reporter scrubs what it sends.
    console.error("trackOrder failed", safeErrorSummary(e));
    await captureException(e, { source: "action", route: "/track" });
    return {
      status: "error",
      values,
      message: "Something went wrong on our side. Please try again.",
    };
  }
}

/** "PostgresError 57014"-style summary with no message text (which may echo bound parameters). */
function safeErrorSummary(e: unknown): string {
  if (!(e instanceof Error)) return "unknown";
  const code = (e as { code?: unknown }).code ?? (e.cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? `${e.name} ${code}` : e.name;
}
