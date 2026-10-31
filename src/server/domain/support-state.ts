/**
 * Support state machines (plan 7.8, section 11). Table-driven, pure, like `order-state.ts`.
 * Same-state "transitions" are not transitions: `canMoveCase` / `canMoveContact` return false for them.
 */

export const CONTACT_STATUSES = ["new", "open", "closed"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const SUPPORT_STATUSES = ["open", "in_progress", "resolved", "rejected"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_TYPES = ["damaged", "defective", "wrong", "missing", "other"] as const;
export type SupportType = (typeof SUPPORT_TYPES)[number];

export const SUPPORT_RESOLUTIONS = ["refund", "replacement", "rejected"] as const;
export type SupportResolution = (typeof SUPPORT_RESOLUTIONS)[number];

/**
 * Contact messages: `new -> open` (someone picked it up / replied), `open -> closed`, `new -> closed`
 * (spam, duplicates) and `closed -> open` (the customer wrote again). Nothing goes back to `new`.
 */
export const CONTACT_TRANSITIONS: Readonly<Record<ContactStatus, readonly ContactStatus[]>> = {
  new: ["open", "closed"],
  open: ["closed"],
  closed: ["open"],
};

/**
 * Support cases: `open -> in_progress`, then either terminal outcome. A case can also be decided
 * straight from `open`. `resolved` and `rejected` have no exits (a new problem is a new case).
 */
export const CASE_TRANSITIONS: Readonly<Record<SupportStatus, readonly SupportStatus[]>> = {
  open: ["in_progress", "resolved", "rejected"],
  in_progress: ["resolved", "rejected"],
  resolved: [],
  rejected: [],
};

/** Cases the team still has to act on. */
export const ACTIVE_CASE_STATUSES = [
  "open",
  "in_progress",
] as const satisfies readonly SupportStatus[];

/** Messages the team still has to act on. */
export const ACTIVE_CONTACT_STATUSES = ["new", "open"] as const satisfies readonly ContactStatus[];

export function canMoveContact(from: ContactStatus, to: ContactStatus): boolean {
  return CONTACT_TRANSITIONS[from].includes(to);
}

export function canMoveCase(from: SupportStatus, to: SupportStatus): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}

export function isActiveCase(status: SupportStatus): boolean {
  return (ACTIVE_CASE_STATUSES as readonly string[]).includes(status);
}

/** The terminal case status that goes with a resolution. */
export function statusForResolution(resolution: SupportResolution): "resolved" | "rejected" {
  return resolution === "rejected" ? "rejected" : "resolved";
}
