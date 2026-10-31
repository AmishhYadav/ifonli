import type { Page } from "@playwright/test";

export const VIBES = ["cute", "bold", "overthinking", "gothic", "funky"] as const;
export type Vibe = (typeof VIBES)[number];

/**
 * Opens `path` in a vibe: the `?vibe=` parameter is read by the head script before first paint,
 * exactly like a shared link.
 */
export async function gotoVibe(page: Page, path: string, vibe: Vibe): Promise<void> {
  const url = new URL(path, "http://x");
  url.searchParams.set("vibe", vibe);
  await page.goto(`${url.pathname}${url.search}${url.hash}`);
  await page.waitForFunction((v) => document.documentElement.dataset.vibe === v, vibe);
}
