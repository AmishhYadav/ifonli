"use client";

import { VIBE_NAMES } from "@/features/vibe/config";
import { useVibe } from "@/features/vibe/useVibe";

export function CurrentVibe() {
  const { vibe } = useVibe();
  return (
    <p className="text-sm text-ink-muted" data-testid="current-vibe">
      Active vibe: <strong className="text-ink">{VIBE_NAMES[vibe]}</strong> ({vibe})
    </p>
  );
}
