"use client";

import { useEffect } from "react";

import { installClientErrorListeners } from "@/lib/monitoring/client";

/** Mounts the window error / unhandled-rejection listeners once. Renders nothing. */
export function ClientErrorReporter() {
  useEffect(() => installClientErrorListeners(), []);
  return null;
}
