"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { useVibe } from "./useVibe";
import { syncUrl } from "./store";

/**
 * Keeps `?vibe=<current>` on the URL after every client-side navigation so any copied URL shares the theme.
 * Uses history.replaceState only (no router navigation). `syncUrl` is a no-op when the param already
 * matches, so the searchParams change it causes cannot loop.
 */
export function VibeUrlSync() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { vibe } = useVibe();

  useEffect(() => {
    syncUrl(vibe);
  }, [pathname, searchParams, vibe]);

  return null;
}
