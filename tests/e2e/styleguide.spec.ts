import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * UI primitives e2e. Intended to run against a production build with dev pages enabled:
 *   NEXT_PUBLIC_ENABLE_DEV_PAGES=1 pnpm build && pnpm start -p 3100
 *   E2E_BASE_URL=http://localhost:3100 pnpm exec playwright test styleguide
 */

const VIBES = ["cute", "funky", "bold", "gothic"] as const;
const col = (page: Page, name: string) => page.getByTestId(`col-${name}`);

test.beforeEach(async ({ page }) => {
  await page.goto("/styleguide");
  await expect(page.getByRole("heading", { level: 1, name: "Styleguide" })).toBeVisible();
});

test("renders every vibe column plus a buy-scope column", async ({ page }) => {
  for (const v of VIBES) {
    const c = col(page, v);
    await expect(c).toHaveAttribute("data-vibe", v);
    await expect(c.getByRole("button", { name: "Primary" })).toBeVisible();
    await expect(c.getByTestId("product-card")).toHaveCount(1);
  }
  const buy = col(page, "buy");
  await expect(buy).toHaveAttribute("data-vibe-scope", "buy");
  await expect(buy.getByRole("button", { name: "Primary" })).toBeVisible();
  // Product grid with every card state, including a sold-out card that is still linked.
  const sold = page.locator('[data-testid="product-card"][data-sold-out]').first();
  await expect(sold.getByRole("link")).toHaveAttribute("href", /\/products\//);
});

test("Buy scope resets shape: Mochi's 20px cards, the base 16px in the buy column", async ({ page }) => {
  const cardRadius = (name: string) =>
    col(page, name).evaluate((el) => getComputedStyle(el).getPropertyValue("--radius-card").trim());
  expect(await cardRadius("cute")).toBe("20px");
  expect(await cardRadius("buy")).toBe("16px");
});

test("buttons and steppers meet the 44px touch target", async ({ page }) => {
  const c = col(page, "cute");
  for (const name of ["Primary", "Small"]) {
    const box = await c.getByRole("button", { name, exact: true }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  const plus = await c.getByRole("button", { name: "Increase quantity" }).boundingBox();
  expect(plus?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(plus?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("quantity stepper: keyboard, limits and announcements", async ({ page }) => {
  const group = col(page, "bold").getByRole("group", { name: "Quantity" }).last();
  const input = group.getByRole("spinbutton");
  await expect(input).toHaveValue("2");
  await input.focus();
  await page.keyboard.press("ArrowUp");
  await expect(input).toHaveValue("3");
  await page.keyboard.press("End");
  await expect(input).toHaveValue("5");
  await expect(group.getByRole("status")).toHaveText("Quantity 5, maximum");
  await expect(group.getByRole("button", { name: "Increase quantity" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Home");
  await expect(input).toHaveValue("1");
});

test("dialog opens and closes with the keyboard and returns focus", async ({ page }) => {
  const trigger = col(page, "funky").getByRole("button", { name: "Open dialog" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Notify me" });
  await expect(dialog).toBeVisible();
  // The portalled dialog wears the vibe of the column it opened from.
  await expect(dialog).toHaveAttribute("data-vibe", "funky");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Email")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  // Close button and Cancel also work.
  await trigger.click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("buy-scope dialog keeps the buy scope", async ({ page }) => {
  await col(page, "buy").getByRole("button", { name: "Open dialog" }).click();
  const dialog = page.getByRole("dialog", { name: "Notify me" });
  await expect(dialog).toHaveAttribute("data-vibe-scope", "buy");
  await page.keyboard.press("Escape");
});

test("drawer traps focus, locks scroll and closes with Escape", async ({ page }) => {
  const trigger = col(page, "gothic").getByRole("button", { name: "Open cart drawer" });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Your bag" });
  await expect(drawer).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");

  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="dialog"]')),
    );
    expect(inside).toBe(true);
  }
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Shift+Tab");
    const inside = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="dialog"]')),
    );
    expect(inside).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("left drawer opens from the left", async ({ page }) => {
  await col(page, "cute").getByRole("button", { name: "Menu drawer" }).click();
  const drawer = page.getByRole("dialog", { name: "Menu" });
  await expect(drawer).toHaveAttribute("data-side", "left");
  await expect.poll(async () => (await drawer.boundingBox())?.x ?? 1).toBe(0);
  await page.keyboard.press("Escape");
});

test("toast is announced in a polite live region, has an action and auto-dismisses", async ({
  page,
}) => {
  const region = page.getByRole("region", { name: "Notifications" });
  const live = region.getByRole("status");
  await expect(live).toHaveAttribute("aria-live", "polite");
  await col(page, "cute").getByRole("button", { name: "Added-to-cart toast" }).click();
  await expect(live).toContainText("Added to cart");
  await expect(live.getByRole("link", { name: "View cart" })).toBeVisible();
  // duration is 2.5s in the demo
  await expect(live).not.toContainText("Added to cart", { timeout: 6000 });
});

test("toast pauses while hovered", async ({ page, isMobile }) => {
  test.skip(isMobile, "hover is a pointer-only interaction");
  const live = page.getByRole("region", { name: "Notifications" }).getByRole("status");
  await col(page, "cute").getByRole("button", { name: "Added-to-cart toast" }).click();
  const toast = live.getByText("Added to cart");
  await expect(toast).toBeVisible();
  await toast.hover();
  await page.waitForTimeout(3500);
  await expect(toast).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(toast).toBeHidden({ timeout: 6000 });
});

test("form fields are wired for assistive tech", async ({ page }) => {
  const c = col(page, "cute");
  const email = c.getByLabel("Email", { exact: true }).first();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  const describedBy = await email.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`[id="${describedBy}"]`)).toContainText("Enter a valid email address.");
  const pincode = c.getByLabel("Pincode", { exact: false }).first();
  await expect(pincode).toHaveAttribute("required", "");
  await expect(pincode).toHaveAccessibleDescription("6 digits, used to check delivery.");
});

test("no serious or critical accessibility violations", async ({ page }) => {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    bad.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => n.target) })),
  ).toEqual([]);
});

test("no serious or critical violations with a dialog open", async ({ page }) => {
  await col(page, "funky").getByRole("button", { name: "Open dialog" }).click();
  await expect(page.getByRole("dialog", { name: "Notify me" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target) }))).toEqual([]);
});
