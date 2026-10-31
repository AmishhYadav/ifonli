/**
 * Funnel maths (pure). The stages are nested: a session counts at a stage only if it also reached every
 * earlier one, so the counts can only go down and every step has a clear conversion rate.
 */
export const FUNNEL_STAGES = [
  { key: "sessions", label: "Sessions", event: "page_view" },
  { key: "pdp", label: "Viewed a product", event: "pdp_view" },
  { key: "cart", label: "Added to cart", event: "add_to_cart" },
  { key: "checkout", label: "Started checkout", event: "begin_checkout" },
  { key: "purchase", label: "Purchased", event: "purchase" },
] as const;

export type FunnelKey = (typeof FUNNEL_STAGES)[number]["key"];

export type FunnelCounts = Record<FunnelKey, number>;

export interface FunnelStep {
  key: FunnelKey;
  label: string;
  count: number;
  /** Share of the first stage, 0..1 (null when nobody started). */
  ofStart: number | null;
  /** Share of the previous stage, 0..1 (null for the first stage or an empty previous stage). */
  ofPrevious: number | null;
  /** Sessions lost since the previous stage. */
  dropped: number;
}

export function buildFunnel(counts: FunnelCounts): FunnelStep[] {
  const steps: FunnelStep[] = [];
  let previous: number | null = null as number | null;
  const start = Math.max(0, counts[FUNNEL_STAGES[0].key]);
  for (const stage of FUNNEL_STAGES) {
    // Defensive clamp: never more than the stage before, never negative.
    const raw = Math.max(0, counts[stage.key]);
    const count: number = previous === null ? raw : Math.min(raw, previous);
    steps.push({
      key: stage.key,
      label: stage.label,
      count,
      ofStart: start > 0 ? count / start : null,
      ofPrevious: previous !== null && previous > 0 ? count / previous : null,
      dropped: previous === null ? 0 : previous - count,
    });
    previous = count;
  }
  return steps;
}

/** "12.3%" for a 0..1 ratio, "-" when unknown. */
export function formatPercent(ratio: number | null, digits = 1): string {
  return ratio === null || !Number.isFinite(ratio) ? "-" : `${(ratio * 100).toFixed(digits)}%`;
}
