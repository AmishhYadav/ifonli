import { expect, test, type Page } from "@playwright/test";

import { axeViolations } from "../support/axe";
import { VIBES, gotoVibe } from "../support/vibes";

/**
 * The scroll-through landing page at `/`. Needs only a running server (settings are read through the app,
 * falling back to the store facts when they are not set up).
 */

const STORE = /\/home(\?|$)/;
const LANDING = /^[^?#]*\/(\?.*)?$/;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

/** Wheel to the end in steps, like a person scrolling. Stops as soon as the page navigates away. */
async function wheelToEnd(page: Page, steps = 140) {
  await page.mouse.move(400, 300);
  for (let i = 0; i < steps; i += 1) {
    if (STORE.test(new URL(page.url()).pathname + new URL(page.url()).search)) return;
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(40);
  }
}

test.describe("landing page", () => {
  test("renders one h1, the chapters and an Enter button to /home", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("IfOnli");
    await expect(page.getByText("Tiny things. Big feelings.")).toBeVisible();
    for (const name of ["Three kinds of tiny.", "Four moods, one for every you.", "Small things, handled with care.", "Ready? Step inside."]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeAttached();
    }
    const enter = page.getByRole("link", { name: "Enter the store" });
    await expect(enter).toHaveAttribute("href", "/home");
    await expect(page.getByRole("link", { name: "Skip intro" })).toHaveAttribute("href", "/home");
    // Landing metadata and the Organization data moved here from the store home.
    await expect(page).toHaveTitle("IfOnli: charms, 3D stickers and DIY kits");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https?:\/\/[^/]+\/?$/);
    expect(await page.locator('script[type="application/ld+json"]').allTextContents()).toEqual(
      expect.arrayContaining([expect.stringContaining('"Organization"')]),
    );
  });

  test("Skip intro goes to the store", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: "Skip intro" }).click();
    await expect(page).toHaveURL(STORE);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("the Enter the store button navigates to the store", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Dispatch the click: in the small portal window the button can sit under the sticky top bar on phones.
    await page.getByRole("link", { name: "Enter the store" }).dispatchEvent("click");
    await expect(page).toHaveURL(STORE);
  });

  test("the store links go to /home, not back to the landing", async ({ page }) => {
    await page.goto("/home");
    await expect(page.getByRole("link", { name: /IfOnli, home/ }).first()).toHaveAttribute("href", "/home");
  });

  test("no horizontal overflow, at the top and mid-page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await settle(page);
    for (const y of [0, 2200, 4800, 7000]) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(300);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, `scrollX at y=${y}`).toBeLessThanOrEqual(clientWidth);
    }
  });

  test("tap targets are at least 44px", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    for (const name of ["Skip intro", "IfOnli, go to the store"]) {
      const box = await page.getByRole("link", { name }).boundingBox();
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
      expect(box!.width, name).toBeGreaterThanOrEqual(44);
    }
  });

  test("axe: no violations at the top of the page (default motion)", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    // The opening entrance runs for about 2 s; read colours after it.
    await page.waitForTimeout(2000);
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe("desktop hand-off", () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, "wheel scrolling is a desktop gesture");
  });
  test.setTimeout(90_000);

  test("wheel-scrolling to the bottom enters the store, Back returns to the top and stays", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    await wheelToEnd(page);
    await expect(page).toHaveURL(STORE, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Plain native scroll on the store: Lenis is gone.
    await expect(page.locator("html.lenis")).toHaveCount(0);

    await page.goBack();
    await expect(page).toHaveURL(LANDING);
    await expect(page.getByRole("heading", { level: 1, name: "IfOnli" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);
    // It must not bounce straight back to the store.
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(LANDING);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(5);

    // And the choreography is alive again after Back: a second pass enters the store once more.
    await wheelToEnd(page);
    await expect(page).toHaveURL(STORE, { timeout: 15_000 });
  });

  test("scripted scrolling alone (no wheel, touch or key) never hands off", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(2500);
    await expect(page).toHaveURL(LANDING);
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("every chapter is visible and stacked, and scrolling to the bottom does not navigate", async ({ page, isMobile }) => {
    await page.goto("/");
    await settle(page);
    await expect(page.locator("[data-landing]")).not.toHaveAttribute("data-motion", /.*/);
    await expect(page.locator("html.lenis")).toHaveCount(0);
    for (const text of [
      "Tiny things. Big feelings.",
      "Three kinds of tiny.",
      "Charms",
      "3D Stickers",
      "DIY Accessories",
      "Mochi",
      "Chaos Cabinet",
      "Unapologetic",
      "After the Dark",
      "Small things, handled with care.",
      "Ready? Step inside.",
    ]) {
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Enter the store" })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    if (!isMobile) await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(2500);
    await expect(page).toHaveURL(LANDING);
    // Nothing is pinned or hidden: the stages are plain blocks and every mood panel is in flow.
    const stage = await page.evaluate(() => getComputedStyle(document.querySelector(".l-moods__stage")!).position);
    expect(stage).toBe("static");
    const opacities = await page.$$eval(".l-mood", (els) => els.map((el) => getComputedStyle(el).opacity));
    expect(opacities).toEqual(["1", "1", "1", "1"]);
  });

  for (const vibe of VIBES) {
    test(`axe: static page in ${vibe}`, async ({ page }) => {
      await gotoVibe(page, "/", vibe);
      await settle(page);
      expect(await axeViolations(page)).toEqual([]);
    });
  }
});
