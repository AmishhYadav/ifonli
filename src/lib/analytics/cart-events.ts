/**
 * Pure helpers that turn a cart change into the quantity an analytics event should report. The cart
 * clamps quantities (stock, per-line cap), so what the shopper asked for is not always what happened.
 */

/**
 * Units actually added by an "Add to cart". `before` is the line's quantity before the call (null when the
 * client had not loaded the cart yet), `after` the line's quantity in the cart the server returned and
 * `requested` what the shopper chose. Never more than requested, never negative.
 */
export function addedQuantity(before: number | null, after: number, requested: number): number {
  const gained = before === null ? after : after - before;
  return Math.max(0, Math.min(requested, gained));
}

/** Units taken out when a line goes from `before` to `after` (0 removes the line). Never negative. */
export function removedQuantity(before: number, after: number): number {
  return Math.max(0, before - Math.max(0, after));
}
