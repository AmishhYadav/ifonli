"use client";

import { useEffect } from "react";

import { track } from "@/lib/analytics/client";
import { newMilestones, scrollDepthPercent } from "@/lib/analytics/events";

/**
 * Product page analytics: one `pdp_view`, then `pdp_scroll_depth` at 25 / 50 / 75 / 100 % of the page
 * content (`<main id="main">`, so the header and footer do not count) the first time each is reached.
 * Renders nothing.
 */
export function PdpTracker({ productId }: { productId: string }) {
  useEffect(() => {
    track("pdp_view", { productId });

    const content = document.getElementById("main") ?? document.documentElement;
    let reached = 0;
    let frame = 0;

    const check = () => {
      frame = 0;
      const rect = content.getBoundingClientRect();
      const percent = scrollDepthPercent(rect.top, rect.height, window.innerHeight);
      for (const milestone of newMilestones(percent, reached)) {
        reached = milestone;
        track("pdp_scroll_depth", { productId, value: milestone });
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(check);
    };

    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [productId]);

  return null;
}
