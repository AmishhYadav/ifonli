"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { MIX_PATH } from "@/features/vibe/config";
import { useVibe } from "@/features/vibe/useVibe";

import { BRAND_TAGLINE, FALLBACK_LOGO_TAGLINE, LOGO_TAGLINES } from "./logo-taglines";

function Line() {
  const pathname = usePathname();
  const { vibe } = useVibe();
  // The brand line belongs to the home page alone (even after the hand is turned there); every other page shows
  // the line of the mood being worn, and only that line.
  return <>{MIX_PATH.test(pathname) ? BRAND_TAGLINE : (LOGO_TAGLINES[vibe] ?? FALLBACK_LOGO_TAGLINE)}</>;
}

/** The small line under the IfOnli wordmark: "If only it was available." on the home page, the mood's own line elsewhere; one line at a time, chosen in React so no CSS can show two. */
export function LogoTagline() {
  return (
    <Suspense fallback={BRAND_TAGLINE}>
      <Line />
    </Suspense>
  );
}
