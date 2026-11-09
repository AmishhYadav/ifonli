"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect } from "react";

import { MIX_ATTRIBUTE, MIX_PATH } from "./config";

/**
 * Keeps `html[data-mix]` in step with the route after client-side navigations (the head script sets it for the
 * first load). On the home page the neutral mixed theme replaces the worn vibe's look; everywhere else it is off,
 * so a collection page shows its own vibe. The worn vibe itself (`data-vibe`) is never touched, so the hand
 * button, the cookie and the other pages keep working as before.
 */
export function MixMode() {
  const pathname = usePathname();
  useLayoutEffect(() => {
    document.documentElement.toggleAttribute(MIX_ATTRIBUTE, MIX_PATH.test(pathname));
  }, [pathname]);
  return null;
}
