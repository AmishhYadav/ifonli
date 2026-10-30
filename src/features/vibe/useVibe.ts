"use client";

import { useSyncExternalStore } from "react";

import { getServerVibe, getVibe, setVibe, subscribe } from "./store";

/** Active vibe, read from html[data-vibe]. Server snapshot = default vibe (no hydration mismatch). */
export function useVibe() {
  const vibe = useSyncExternalStore(subscribe, getVibe, getServerVibe);
  return { vibe, setVibe };
}
