/** Stock availability helpers (plan 7.5). Pure: time comes in as `now`. */

export type ReservationStatus = "active" | "converted" | "released";

export interface ReservationLike {
  qty: number;
  status: ReservationStatus;
  expiresAt: Date;
}

/**
 * `onHand - sum(qty of reservations that are active AND not expired)`, never below zero.
 * A reservation is unexpired while `expiresAt > now` (the instant of expiry is already free).
 */
export function availableQty(
  onHand: number,
  reservations: readonly ReservationLike[],
  now: Date,
): number {
  const nowMs = now.getTime();
  let reserved = 0;
  for (const r of reservations) {
    if (r.status === "active" && r.expiresAt.getTime() > nowMs) {
      reserved += r.qty;
    }
  }
  return Math.max(0, onHand - reserved);
}

export type ClampLimit = "available" | "max_per_line" | null;

/**
 * Cap a requested quantity at `min(available, maxPerLine)`. Never negative; fractional or
 * non-finite requests are floored / treated as 0.
 */
export function clampQtyWithReason(
  requested: number,
  available: number,
  maxPerLine: number,
): { qty: number; limitedBy: ClampLimit } {
  const want = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0;
  const avail = Math.max(0, Math.floor(available));
  const max = Math.max(0, Math.floor(maxPerLine));
  const cap = Math.min(avail, max);
  if (want <= cap) {
    return { qty: want, limitedBy: null };
  }
  return { qty: cap, limitedBy: avail <= max ? "available" : "max_per_line" };
}

export function clampQty(requested: number, available: number, maxPerLine: number): number {
  return clampQtyWithReason(requested, available, maxPerLine).qty;
}
