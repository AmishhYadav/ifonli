"use client";

import { useEffect } from "react";

import { getVibeFromStorageOrUrl } from "./vibe-restore-helpers";

/**
 * Safety net for the unknown-slug 404: that response is hydrated through Next's error path, which re-applies
 * the server's fallback `data-vibe="cute"` on `<html>` after the head script has already chosen the visitor's
 * vibe. This puts the chosen vibe (URL param, else cookie) back. No-op everywhere else.
 */
export function VibeRestore() {
  useEffect(() => {
    const vibe = getVibeFromStorageOrUrl();
    if (vibe && document.documentElement.dataset.vibe !== vibe) {
      document.documentElement.dataset.vibe = vibe;
    }
  }, []);
  return null;
}
