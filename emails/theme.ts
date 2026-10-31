import { isVibe, type Vibe } from "@/features/vibe/config";
import { resolveTokens } from "@/features/vibe/tokens";

/**
 * Email palette. Email clients need literal colours inline, so the values are read from the vibe
 * tokens (the only place raw hex lives) and passed around as plain strings. An order placed before
 * `vibe_at_order` existed (or with an unknown slug) and every admin e-mail use the neutral base.
 */
export interface EmailPalette {
  bg: string;
  surface: string;
  /** Tinted panel / divider colour. */
  surfaceAlt: string;
  ink: string;
  muted: string;
  accent: string;
  onAccent: string;
  /** Highlight stripe next to the accent. */
  highlight: string;
  link: string;
  success: string;
  danger: string;
}

export function paletteFor(vibe: Vibe | string | null | undefined): EmailPalette {
  const { palette: p } = resolveTokens(isVibe(vibe) ? vibe : "base");
  return {
    bg: p.bg,
    surface: p.surface,
    surfaceAlt: p["surface-2"],
    ink: p.ink,
    muted: p["ink-muted"],
    accent: p.accent,
    onAccent: p["on-accent"],
    highlight: p["accent-2"],
    link: p.link,
    success: p.success,
    danger: p.danger,
  };
}
