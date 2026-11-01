/**
 * The small line under the IfOnli wordmark, per vibe. (Not `components/store/vibe-taglines.ts`: those are the
 * neutral descriptions on the vibe cards.) A vibe without an entry falls back to the default vibe's line.
 */
export const LOGO_TAGLINES: Partial<Record<string, string>> = {
  cute: "Soft, sweet & a little bit squishy",
  gothic: "For souls who bloom at midnight",
  funky: "Funky, quirky, gloriously unhinged",
  bold: "Main character energy only",
};

export const FALLBACK_LOGO_TAGLINE = LOGO_TAGLINES.cute!;
