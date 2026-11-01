/**
 * Pure PDP helpers (no React, no server imports): the variant matrix, image list and wording. The page
 * builds a `PdpModel` from the cached `ProductDetail`; client components never see HSN, GST or stock rows
 * (stock arrives separately from the uncached `getLiveAvailability`).
 */

export interface PdpOptionValue {
  id: string;
  value: string;
  swatchHex: string | null;
}

export interface PdpOption {
  id: string;
  name: string;
  values: PdpOptionValue[];
}

export interface PdpVariant {
  id: string;
  title: string;
  optionValueIds: string[];
  pricePaise: number;
  mrpPaise: number;
}

export interface PdpModel {
  productId: string;
  name: string;
  options: PdpOption[];
  /** Active variants in display order (`position`). */
  variants: PdpVariant[];
}

export interface PdpImage {
  id: string;
  variantId: string | null;
  src: string;
  alt: string;
  width: number;
  height: number;
  /** Transparent artwork: shown contained on a tinted tile instead of cropped to fill. */
  isCutout: boolean;
}

export function findVariant(model: PdpModel, variantId: string | null | undefined): PdpVariant | null {
  return model.variants.find((v) => v.id === variantId) ?? null;
}

/**
 * The variant to render first: the first one in display order (live stock is not known at render time;
 * `landingVariantId` corrects it once stock streams in).
 */
export function defaultVariantId(model: PdpModel): string | null {
  return model.variants[0]?.id ?? null;
}

/**
 * The variant to land on once live stock is known, while the shopper has not picked one: the current
 * one if it can be bought, otherwise the first in display order that is in stock (so the page never
 * opens on a disabled "Sold out" button when another colour is available). Unchanged when nothing is
 * in stock or the current variant's stock is unknown.
 */
export function landingVariantId(
  model: PdpModel,
  stock: ReadonlyMap<string, { inStock: boolean }>,
  currentId: string | null,
): string | null {
  const current = currentId ? stock.get(currentId) : undefined;
  if (!current || current.inStock) return currentId;
  return model.variants.find((v) => stock.get(v.id)?.inStock)?.id ?? currentId;
}

/** Variant whose option values are exactly `valueIds` (order independent), or null for a hole in the matrix. */
export function variantForValues(model: PdpModel, valueIds: readonly string[]): PdpVariant | null {
  const wanted = new Set(valueIds);
  return (
    model.variants.find(
      (v) => v.optionValueIds.length === wanted.size && v.optionValueIds.every((id) => wanted.has(id)),
    ) ?? null
  );
}

/**
 * The variant to switch to when the shopper picks `valueId` of an option while `currentVariantId` is
 * selected. Prefers the exact combination (same values for the other options); when that combination does
 * not exist it keeps as many of the other choices as it can, so a gap in the matrix never traps the shopper.
 * Returns null if no variant has that value.
 */
export function pickVariant(
  model: PdpModel,
  currentVariantId: string | null,
  optionId: string,
  valueId: string,
): PdpVariant | null {
  const option = model.options.find((o) => o.id === optionId);
  if (!option) return null;
  const optionValueIds = new Set(option.values.map((v) => v.id));
  const current = findVariant(model, currentVariantId);
  const keep = new Set((current?.optionValueIds ?? []).filter((id) => !optionValueIds.has(id)));

  let best: PdpVariant | null = null;
  let bestScore = -1;
  for (const variant of model.variants) {
    if (!variant.optionValueIds.includes(valueId)) continue;
    const score = variant.optionValueIds.filter((id) => keep.has(id)).length;
    if (score > bestScore) {
      best = variant;
      bestScore = score;
    }
  }
  return best;
}

export interface OptionValueState {
  id: string;
  value: string;
  swatchHex: string | null;
  selected: boolean;
  /** No active variant has this value at all: cannot be chosen. */
  disabled: boolean;
  /**
   * The exact combination with the other current choices does not exist, so choosing this also changes
   * another option. Still selectable (see `pickVariant`).
   */
  adjusts: boolean;
  /** The variant this click would select (null when disabled). */
  variantId: string | null;
}

export function optionValueStates(
  model: PdpModel,
  currentVariantId: string | null,
): { option: PdpOption; values: OptionValueState[] }[] {
  const current = findVariant(model, currentVariantId);
  const currentValueIds = new Set(current?.optionValueIds ?? []);
  return model.options.map((option) => {
    const ownIds = new Set(option.values.map((x) => x.id));
    const others = [...currentValueIds].filter((id) => !ownIds.has(id));
    return {
      option,
      values: option.values.map((v) => {
        const target = pickVariant(model, currentVariantId, option.id, v.id);
        const exact = variantForValues(model, [...others, v.id]) !== null;
        return {
          id: v.id,
          value: v.value,
          swatchHex: v.swatchHex,
          selected: currentValueIds.has(v.id),
          disabled: target === null,
          adjusts: target !== null && !exact,
          variantId: target?.id ?? null,
        };
      }),
    };
  });
}

/** Name of the chosen value for an option ("Colour: Pink"), or null. */
export function selectedValueName(
  model: PdpModel,
  currentVariantId: string | null,
  optionId: string,
): string | null {
  const current = findVariant(model, currentVariantId);
  const option = model.options.find((o) => o.id === optionId);
  if (!current || !option) return null;
  return option.values.find((v) => current.optionValueIds.includes(v.id))?.value ?? null;
}

/** The slide to show for a variant: its own image if it has one, else null (keep the current slide). */
export function imageIndexForVariant(images: readonly PdpImage[], variantId: string | null): number | null {
  if (!variantId) return null;
  const index = images.findIndex((img) => img.variantId === variantId);
  return index >= 0 ? index : null;
}

/** Stock line wording for the selected variant. `lowStock` is the server's genuine threshold decision. */
export type StockStatus =
  | { kind: "in_stock"; label: string }
  | { kind: "low"; label: string }
  | { kind: "sold_out"; label: string };

export function stockStatus(a: { inStock: boolean; lowStock: boolean; available: number } | undefined): StockStatus | null {
  if (!a) return null;
  if (!a.inStock) return { kind: "sold_out", label: "Sold out" };
  if (a.lowStock) return { kind: "low", label: `Only ${a.available} left` };
  return { kind: "in_stock", label: "In stock" };
}

/** Clamp the requested quantity to `1..max` (0 when nothing can be bought). */
export function clampQty(qty: number, max: number): number {
  if (max <= 0) return 0;
  if (!Number.isFinite(qty)) return 1;
  return Math.min(max, Math.max(1, Math.trunc(qty)));
}

const dateFormat = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** "Wed, 4 Nov" from an India calendar date "YYYY-MM-DD" (formatted in UTC so the day never shifts). */
export function formatCalendarDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return dateFormat.format(new Date(Date.UTC(y, m - 1, d)));
}

/** "Wed, 4 Nov to Fri, 6 Nov", or one date when the window is a single day. */
export function formatDeliveryWindow(fromDate: string, toDate: string): string {
  const from = formatCalendarDate(fromDate);
  return fromDate === toDate ? from : `${from} to ${formatCalendarDate(toDate)}`;
}
