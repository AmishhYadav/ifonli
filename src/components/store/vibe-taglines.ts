import type { Vibe } from "@/features/vibe/config";

/**
 * Short neutral taglines for the vibe cards, used when the admin-edited description is empty or still a
 * placeholder. Expressive per-vibe copy belongs in `features/vibe/copy`; these are plain descriptions.
 */
export const VIBE_TAGLINES: Record<Vibe, string> = {
  cute: "Soft, sparkly and impossible to ignore.",
  bold: "Loud colour, hard edges, no apologies.",
  overthinking: "Notes in the margin, doodles on everything.",
  gothic: "Lace, candlelight and quietly dramatic things.",
  funky: "Seventies swirl, big colour, good company.",
};
