/**
 * The "My Profile" details live on the visitor's own device (localStorage), never on a server: a name and a way to
 * reach them, plus the order links this browser has seen. Nothing here proves who someone is, so it unlocks no order
 * data by itself; orders are shown only through the order's own link or the reference + contact lookup (/track).
 */
import { useSyncExternalStore } from "react";

import { emailSchema, normalizeIndianPhone } from "@/features/checkout/schema";

const PROFILE_KEY = "ifonli_profile";
const ORDERS_KEY = "ifonli_orders";
const CHANGE_EVENT = "ifonli:profile-change";
const MAX_ORDERS = 20;

export interface ProfileDetails {
  name: string;
  /** An email address or an Indian mobile number, as the visitor typed it. */
  contact: string;
}

export interface RememberedOrder {
  ref: string;
  /** `/orders/<ref>?t=<token>`: the page that shows the order and its tracking. */
  href: string;
  savedAt: string;
}

/** A name of 1-80 characters. Returns the trimmed name or an error message. */
export function checkName(value: string): { value: string } | { error: string } {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) return { error: "Tell us what to call you" };
  if (name.length > 80) return { error: "That name is a little long, please shorten it" };
  return { value: name };
}

/** An email address or a 10-digit Indian mobile number. Returns the trimmed contact or an error message. */
export function checkContact(value: string): { value: string } | { error: string } {
  const contact = value.trim();
  if (!contact) return { error: "Tell us how to reach you" };
  if (contact.includes("@")) {
    return emailSchema.safeParse(contact).success
      ? { value: contact }
      : { error: "That email address doesn't look right" };
  }
  return normalizeIndianPhone(contact) !== null
    ? { value: contact }
    : { error: "Enter a 10-digit mobile number or an email address" };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: the details just aren't remembered
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** `undefined` while server-rendering / hydrating, `null` when nothing is stored. Strings are compared by value. */
function useRaw(key: string): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => read(key),
    () => undefined,
  );
}

function parseProfile(raw: string | null | undefined): ProfileDetails | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<ProfileDetails>;
    return typeof value.name === "string" && typeof value.contact === "string"
      ? { name: value.name, contact: value.contact }
      : null;
  } catch {
    return null;
  }
}

function parseOrders(raw: string | null | undefined): RememberedOrder[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (o): o is RememberedOrder =>
        typeof o?.ref === "string" &&
        typeof o?.href === "string" &&
        o.href.startsWith("/orders/") &&
        typeof o?.savedAt === "string",
    );
  } catch {
    return [];
  }
}

/** The saved details: `undefined` until the browser has been read, `null` when there are none. */
export function useProfile(): ProfileDetails | null | undefined {
  return parseProfile(useRaw(PROFILE_KEY));
}

export function useRememberedOrders(): RememberedOrder[] {
  return parseOrders(useRaw(ORDERS_KEY));
}

export function saveProfile(details: ProfileDetails): void {
  write(PROFILE_KEY, JSON.stringify(details));
}

/** Forget the details and the order links on this device. */
export function clearProfile(): void {
  write(PROFILE_KEY, null);
  write(ORDERS_KEY, null);
}

/** Keep a link to an order this browser opened with its own token, newest first. */
export function rememberOrder(order: Omit<RememberedOrder, "savedAt">): void {
  const rest = parseOrders(read(ORDERS_KEY)).filter((o) => o.ref !== order.ref);
  const next = [{ ...order, savedAt: new Date().toISOString() }, ...rest].slice(0, MAX_ORDERS);
  write(ORDERS_KEY, JSON.stringify(next));
}
