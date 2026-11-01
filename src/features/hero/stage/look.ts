/** Backing colours and shapes shared by the static poster and the animated stage, so the rest frame matches. */

/** Soft tints of the active vibe's palette cycle so the grid reads as a collage; no outlines, a diffused shadow lifts them. */
export const BACKINGS = [
  "bg-[color-mix(in_srgb,var(--accent)_26%,var(--surface))]",
  "bg-surface-2",
  "bg-[color-mix(in_srgb,var(--accent-2)_30%,var(--surface))]",
  "bg-surface",
  "bg-[color-mix(in_srgb,var(--accent-3)_34%,var(--surface))]",
  "bg-surface-2",
] as const;

export const SHAPES = ["rounded-card", "rounded-full", "rounded-full", "rounded-card"] as const;

export const backingOf = (index: number): (typeof BACKINGS)[number] =>
  BACKINGS[index % BACKINGS.length]!;

export const shapeOf = (index: number): (typeof SHAPES)[number] => SHAPES[index % SHAPES.length]!;
