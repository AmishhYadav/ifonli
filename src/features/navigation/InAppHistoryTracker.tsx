"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { markInAppNavigation, seedInAppHistory } from "./in-app-history";

/** Mounted once in the root layout: seeds the in-app history flag on load and sets it on every route change. */
export function InAppHistoryTracker() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    // Compare with the last pathname seen (not a "first run" flag): Strict Mode runs this effect twice on mount.
    const moved = previous.current !== null && previous.current !== pathname;
    previous.current = pathname;
    if (moved) markInAppNavigation();
    else seedInAppHistory();
  }, [pathname]);

  return null;
}
