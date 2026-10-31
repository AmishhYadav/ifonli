"use server";

import { unstable_rethrow } from "next/navigation";

import { getRequestIp, keyDigest } from "@/features/cart/request";
import { getDb } from "@/server/db";
import { consumeRateLimit } from "@/server/services/rate-limit";
import { lookupOrderForTracking, parseTrackingContact } from "@/server/services/tracking";

import type { TrackFormState } from "./types";

const NOT_FOUND =
  "We couldn't find that order. Check the order reference and the email or mobile number you used at checkout.";

const text = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

/**
 * Guest order lookup (plan 7.11): order reference plus the email or mobile used at checkout. Rate limited
 * by IP and by reference; every mismatch gets the same answer so refs and emails cannot be enumerated.
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
  if (!contact) fieldErrors.contact = "Enter the email or mobile number you used at checkout";
  else if (!parseTrackingContact(contact)) {
    fieldErrors.contact = "Enter a valid email address or a 10-digit mobile number";
  }
  if (fieldErrors.ref || fieldErrors.contact) return { status: "invalid", values, fieldErrors };

  try {
    const db = getDb();
    const decisions = await Promise.all([
      consumeRateLimit(db, `track:ip:${await getRequestIp()}`, { limit: 20, windowSeconds: 600 }),
      consumeRateLimit(db, `track:ref:${keyDigest(ref.toUpperCase())}`, {
        limit: 8,
        windowSeconds: 600,
      }),
    ]);
    const blocked = decisions.find((d) => !d.allowed);
    if (blocked) {
      const minutes = Math.ceil(blocked.retryAfterSeconds / 60);
      return {
        status: "rate_limited",
        values,
        message: `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      };
    }

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
    console.error("trackOrder failed", e);
    return {
      status: "error",
      values,
      message: "Something went wrong on our side. Please try again.",
    };
  }
}
