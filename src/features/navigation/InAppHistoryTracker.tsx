"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { markInAppNavigation, seedInAppHistory } from "./in-app-history";

/** Mounted once in the root layout: seeds the in-app history flag on load and sets it on every route change. */
export function InAppHistoryTracker() {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      seedInAppHistory();
      return;
    }
    markInAppNavigation();
  }, [pathname]);

  return null;
}
