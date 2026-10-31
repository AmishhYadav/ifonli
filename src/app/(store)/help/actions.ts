"use server";

import { unstable_rethrow } from "next/navigation";

import { getRequestIp } from "@/features/cart/request";
import { getDb } from "@/server/db";
import { CONTACT_MESSAGE_MAX, createContactMessage } from "@/server/services/support";

import { EMPTY_CONTACT_VALUES, type ContactFormField, type ContactFormState } from "./types";

const text = (formData: FormData, key: string, max: number) => {
  const value = formData.get(key);
  return typeof value === "string" ? value.slice(0, max) : "";
};

/** Help-page contact form: validation, rate limiting and the message + outbox rows live in `createContactMessage`. */
export async function sendContactMessage(
  _prev: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  const raw = {
    name: text(formData, "name", 200),
    email: text(formData, "email", 300),
    phone: text(formData, "phone", 40),
    orderRef: text(formData, "orderRef", 80),
    message: text(formData, "message", CONTACT_MESSAGE_MAX + 500),
    website: text(formData, "website", 200),
  };
  const values: Record<ContactFormField, string> = { ...EMPTY_CONTACT_VALUES, ...raw };

  try {
    const result = await createContactMessage(getDb(), raw, { ip: await getRequestIp() });
    if (result.ok) return { status: "sent", values: EMPTY_CONTACT_VALUES };
    if (result.reason === "invalid") return { status: "invalid", values, fieldErrors: result.fieldErrors };
    const minutes = Math.ceil(result.retryAfterSeconds / 60);
    return {
      status: "rate_limited",
      values,
      message: `Too many messages from you just now. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    };
  } catch (e) {
    unstable_rethrow(e);
    console.error("sendContactMessage failed", e);
    return {
      status: "error",
      values,
      message: "Something went wrong on our side. Your message was not sent, please try again.",
    };
  }
}
