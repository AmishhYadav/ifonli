"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import type { Vibe } from "@/features/vibe/config";
import { VIBE_NAMES } from "@/features/vibe/config";
import { setVibe } from "@/features/vibe/store";
import { useVibe } from "@/features/vibe/useVibe";

/**
 * "Wear this vibe" on a vibe collection page: switches the whole site to this vibe (the page header is
 * already scoped to it, so it never changes by itself). Same cross-fade as the hand button.
 */
export function WearVibeButton({ vibe, children }: { vibe: Vibe; children: ReactNode }) {
  const { vibe: current } = useVibe();
  const wearing = current === vibe;

  const wear = () => {
    if (wearing) return;
    const startedAt = performance.now();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced && typeof document.startViewTransition === "function") {
      let release: () => void = () => {};
      const settled = new Promise<void>((resolve) => {
        release = resolve;
      });
      const transition = document.startViewTransition(() => {
        setVibe(vibe, { source: "api", startedAt, settled, usedViewTransition: true });
      });
      transition.finished.then(release, release);
    } else {
      setVibe(vibe, { source: "api", startedAt, usedViewTransition: false });
    }
  };

  return (
    <Button
      size="lg"
      onClick={wear}
      aria-pressed={wearing}
      iconStart={wearing ? "check" : "sparkle"}
      data-testid="wear-vibe"
    >
      {wearing ? `You're wearing ${VIBE_NAMES[vibe]}` : children}
    </Button>
  );
}
