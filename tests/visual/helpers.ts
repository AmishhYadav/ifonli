import { expect, type Locator, type Page } from "@playwright/test";

/** Tall pages (the shop grid) are cropped to this many CSS px so baselines stay a sensible size. */
export const MAX_SHOT_HEIGHT = 2400;

export const visualEnabled = process.env.E2E_VISUAL === "1";

/** Fixed "now" for client code (relative dates, "new" badges, countdowns). Timers keep running. */
export const FROZEN_NOW = new Date("2026-10-31T10:00:00+05:30");

/**
 * Loads every lazy image by scrolling through the page, waits for fonts and images, then returns to the top.
 * Without this a full-page screenshot would catch half-loaded `loading="lazy"` images.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
    const height = () => document.documentElement.scrollHeight;
    for (let y = 0; y < Math.min(height(), 6000); y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
    await document.fonts.ready;
    const images = Array.from(document.images).filter((img) => img.getClientRects().length > 0);
    await Promise.all(
      images.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((r) => {
              img.onload = img.onerror = () => r(null);
            }),
      ),
    );
  });
  await page.waitForLoadState("networkidle");
}

/** Hides the Next.js dev indicator (dev servers only) and anything else that is not part of the product. */
export async function hideChrome(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      "nextjs-portal, [data-nextjs-toast], [data-next-badge-root] { display: none !important; }",
  });
}

/** Screenshot of the page from the top, cropped to MAX_SHOT_HEIGHT, with `masks` painted over. */
export async function snap(
  page: Page,
  name: string,
  options: { mask?: Locator[]; maxHeight?: number } = {},
): Promise<void> {
  await hideChrome(page);
  await settle(page);
  const width = page.viewportSize()!.width;
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  const height = Math.min(full, options.maxHeight ?? MAX_SHOT_HEIGHT);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    clip: { x: 0, y: 0, width, height },
    mask: options.mask,
  });
}
