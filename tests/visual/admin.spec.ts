import { randomBytes } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { createAdminSession, cleanupQaAdmins, type AdminLogin } from "../support/admin";
import { applyCommerce, cleanupQa, insertQaOrder } from "../support/commerce";

import { FROZEN_NOW, snap, visualEnabled } from "./helpers";

/**
 * Admin screenshots at 1440 px (the admin is a desktop tool and is never themed). The data on these pages
 * is live (counts, recent orders, stock), so the regions that hold it are masked: the layout, navigation,
 * headings, filters, cards and forms are what is compared. The fixed order QA31 keeps the detail page stable.
 */

test.skip(!visualEnabled, "set E2E_VISUAL=1 (see tests/visual/README.md)");
test.describe.configure({ mode: "serial" });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "visual-1440", "admin screenshots are taken at 1440 px only");
});

const ORDER_REF = "IFO-2610-QA31";
let restore: () => Promise<void> = async () => {};
let admin: AdminLogin;
let orderId = "";

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  await cleanupQa();
  restore = await applyCommerce();
  orderId = await insertQaOrder({
    ref: ORDER_REF,
    email: "qa-visual-admin@example.com",
    token: `qa-${randomBytes(24).toString("base64url")}`,
    paymentMethod: "cod",
    status: "confirmed",
    paymentStatus: "cod_pending",
    fulfillment: "unfulfilled",
  });
  admin = await createAdminSession(browser, baseURL!, "owner");
});

test.afterAll(async () => {
  await cleanupQa();
  await cleanupQaAdmins();
  await restore();
});

const live = (page: Page) => [
  page.locator("main tbody"),
  page.locator("main .tabular-nums"),
  page.locator("main svg[role='img']"),
  page.locator("main time"),
  page.locator("[data-visual-mask]"),
];

const PAGES: { name: string; path: () => string; mask?: boolean }[] = [
  { name: "dashboard", path: () => "/admin" },
  { name: "orders", path: () => "/admin/orders" },
  { name: "order-detail", path: () => `/admin/orders/${orderId}` },
  { name: "products", path: () => "/admin/products" },
  { name: "inventory", path: () => "/admin/inventory" },
  { name: "collections", path: () => "/admin/collections" },
  { name: "discounts", path: () => "/admin/discounts" },
  { name: "support", path: () => "/admin/support" },
  { name: "content", path: () => "/admin/content" },
  { name: "faq", path: () => "/admin/faq" },
  { name: "policies", path: () => "/admin/policies" },
  { name: "settings", path: () => "/admin/settings" },
  { name: "users", path: () => "/admin/users" },
  { name: "audit", path: () => "/admin/audit" },
  { name: "reports", path: () => "/admin/reports" },
  { name: "insights", path: () => "/admin/insights" },
];

for (const p of PAGES) {
  test(`admin ${p.name}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      storageState: admin.storageState,
      viewport: { width: 1440, height: 900 },
      colorScheme: "light",
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(FROZEN_NOW);
    await page.goto(p.path());
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await snap(page, `admin-${p.name}`, { mask: live(page) });
    await context.close();
  });
}

test("admin sign-in", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await snap(page, "admin-login");
  await context.close();
});
