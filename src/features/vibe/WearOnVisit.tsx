"use client";

import { useEffect } from "react";

import type { Vibe } from "./config";
import { getVibe } from "./store";
import { switchVibeTo } from "./switch";

/**
 * Mounted on a vibe collection page: visiting `/vibes/<slug>` wears that vibe for the whole site (the demo's
 * "theme and collection are one thing"). A no-op when the site already wears it (the usual case: the hand,
 * a pill or the head script, which reads the path, got there first), so it only switches on a client-side
 * navigation or back/forward into a vibe page that is not the current vibe.
 */
export function WearOnVisit({ vibe }: { vibe: Vibe }) {
  useEffect(() => {
    if (getVibe() !== vibe) void switchVibeTo(vibe, "page");
  }, [vibe]);
  return null;
}
