"use client";

import { useLayoutEffect } from "react";

import { LANDING_VIBE } from "@/features/vibe/config";
import { wearWithoutSaving } from "@/features/vibe/store";

/**
 * The landing page always opens in Mochi. The head script does that on a first load (and skips the saved vibe);
 * this covers arriving by client-side navigation (the store's logo, Back) and puts the visitor's own saved vibe
 * back when they leave, so the store behaves exactly as before. Nothing is written to the cookie or storage.
 */
export function LandingVibe() {
  useLayoutEffect(() => wearWithoutSaving(LANDING_VIBE), []);
  return null;
}
