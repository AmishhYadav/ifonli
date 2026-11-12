import { expect, test, type Page } from "@playwright/test";

/**
 * The DIY page builds a pack: every charm has "Add to kit"; the tray has five boxes, box 1 is the free chain,
 * boxes 2 to 5 take up to four charms; "Add to bag" works from the first charm. Needs the dev database with the
 * placeholder product seed and migration 0008 (the free chain).
 */

const settle = (page: Page) => page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
const tray = (page: Page) => page.getByTestId("kit-tray");
const filled = (page: Page) => page.locator('[data-testid="kit-slot"][data-filled]');
const money = (text: string | null) => Number((text ?? "").replace(/[^\d.]/g, ""));

async function openDiy(page: Page) {
  await page.goto("/types/diy-accessories");
  await settle(page);
  await expect(tray(page)).toBeVisible();
}

test.describe("DIY pack", () => {
  test("lists the charms with Add to kit and an empty tray that already holds the free chain", async ({ page }) => {
    await openDiy(page);
    expect(await page.getByTestId("kit-add").count()).toBeGreaterThan(0);
    await expect(page.getByTestId("quick-add")).toHaveCount(0);
    await expect(tray(page).getByTestId("kit-chain")).toContainText("Included");
    await expect(tray(page).getByTestId("kit-slot")).toHaveCount(4);
    await expect(filled(page)).toHaveCount(0);
    await expect(tray(page).getByRole("button", { name: /^Remove from kit:/ })).toHaveCount(0);
    await expect(page.getByTestId("kit-add-to-cart")).toBeDisabled();
  });

  test("Add to bag works from one charm; the pack costs the charms, and the chain rides along free", async ({ page, browserName, baseURL }) => {
    test.skip(browserName === "webkit" && !baseURL?.startsWith("https:"), "WebKit drops the Secure cart cookie over http");
    await openDiy(page);
    await page.getByTestId("kit-add").first().click();
    const total = tray(page).getByTestId("kit-total");
    await expect(total).toBeVisible();
    await expect(tray(page).getByTestId("kit-status")).toContainText("Free chain + 1 of 4 charms");
    const price = money(await total.textContent());
    expect(price).toBeGreaterThan(0);

    await page.getByTestId("kit-add-to-cart").click();
    await expect(page.getByRole("button", { name: "View bag" })).toBeVisible();
    await expect(filled(page)).toHaveCount(0); // the tray is clear again
    await page.getByRole("button", { name: "View bag" }).click();
    const drawer = page.getByTestId("cart-drawer");
    await expect(drawer.getByTestId("cart-line")).toHaveCount(2);
    await expect(drawer.locator("[data-diy-chain]")).toContainText("Included with your DIY pack");
    await expect(drawer.locator("[data-diy-chain]")).toContainText("Free");
  });

  test("a pack holds four charms: the fifth Add to kit is refused", async ({ page }) => {
    await openDiy(page);
    const adds = page.getByTestId("kit-add");
    for (let i = 0; i < 4; i += 1) await adds.nth(i).click();
    await expect(tray(page).getByTestId("kit-status")).toContainText("Free chain + 4 of 4 charms");
    await adds.nth(4).click();
    await expect(page.getByText("Your kit is full")).toBeVisible();
    await expect(filled(page)).toHaveCount(4);
    // removing one frees a box
    await tray(page).getByRole("button", { name: /^Remove from kit:/ }).first().click();
    await expect(filled(page)).toHaveCount(3);
  });

  test("charms keep their normal Add to bag everywhere else", async ({ page }) => {
    await page.goto("/types/charms");
    await settle(page);
    await expect(page.getByTestId("kit-add")).toHaveCount(0);
    await expect(page.getByTestId("quick-add").first()).toBeVisible();
  });
});
