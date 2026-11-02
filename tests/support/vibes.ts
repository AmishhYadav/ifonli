import type { Page } from "@playwright/test";

export const VIBES = ["cute", "funky", "bold", "gothic"] as const;
export type Vibe = (typeof VIBES)[number];

/**
 * Opens `path` in a vibe: the `?vibe=` parameter is read by the head script before first paint,
 * exactly like a shared link.
 */
export async function gotoVibe(page: Page, path: string, vibe: Vibe): Promise<void> {
  const url = new URL(path, "http://x");
  // A vibe's own page always wears that vibe (the path wins over `?vibe=`), so "the vibe page in gothic" is
  // /vibes/gothic: point a /vibes/<slug> path at the requested vibe instead of waiting for a theme it never shows.
  if (/^\/vibes\/[a-z]+\/?$/.test(url.pathname)) url.pathname = `/vibes/${vibe}`;
  url.searchParams.set("vibe", vibe);
  await page.goto(`${url.pathname}${url.search}${url.hash}`);
  await page.waitForFunction((v) => document.documentElement.dataset.vibe === v, vibe);
}
