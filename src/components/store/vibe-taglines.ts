import type { Vibe } from "@/features/vibe/config";

/**
 * Short taglines for the vibe cards, used when the admin-edited description is empty or still a
 * placeholder. Expressive per-vibe copy belongs in `features/vibe/copy`; these are the plain one-liners.
 */
export const VIBE_TAGLINES: Record<Vibe, string> = {
  cute: "Soft, sweet & a little bit squishy",
  funky: "Funky, quirky, gloriously unhinged",
  bold: "Main character energy only",
  gothic: "For souls who bloom at midnight",
};
