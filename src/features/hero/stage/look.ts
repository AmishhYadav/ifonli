/** Backing colours and shapes shared by the static poster and the animated stage, so the rest frame matches. */

/** Backing colours cycle so the grid reads as a collage, in whichever vibe's tokens are active. */
export const BACKINGS = [
  "bg-accent",
  "bg-surface-2",
  "bg-accent-2",
  "bg-surface",
  "bg-accent-3",
  "bg-surface-2",
] as const;

export const SHAPES = ["rounded-card", "rounded-full", "rounded-full", "rounded-card"] as const;

export const backingOf = (index: number): (typeof BACKINGS)[number] =>
  BACKINGS[index % BACKINGS.length]!;

export const shapeOf = (index: number): (typeof SHAPES)[number] => SHAPES[index % SHAPES.length]!;
