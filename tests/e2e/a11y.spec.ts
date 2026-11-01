import { randomBytes } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { createAdminSession, cleanupQaAdmins, type AdminLogin } from "../support/admin";
import { axeViolations } from "../support/axe";
import {
  applyCommerce,
  cleanupQa,
  insertQaOrder,
  seedCart,
  signInCustomer,
} from "../support/commerce";
import { sql } from "../support/db";
import { VIBES, gotoVibe, type Vibe } from "../support/vibes";
import { acquireFixtureLock, releaseFixtureLock } from "../support/fixture-lock";

/**
 * WCAG 2.2 AA scan (axe-core, tags wcag2a/2aa/21a/21aa/22aa, every impact level) of every storefront page
 * type in all five vibes, the customer account, and the admin pages.
 *
 * Needs the dev stack: a migrated + seeded database (`pnpm db:seed`, `db:seed-products`, `db:seed-content`)
 * and a running server (`next dev` or `next start`):
 *
 *   E2E_BASE_URL=http://localhost:3108 pnpm e2e tests/e2e/a11y.spec.ts --project=chromium-desktop
 *
 * Fixtures (qa- e-mails, IFO-2610-QA* orders, one owner admin) are created at the start and removed at the end.
 */

test.describe.configure({ mode: "default" });
test.setTimeout(180_000);
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "scans run once, on desktop Chromium");
});

const SHOPPER = "qa-a11y@example.com";
const GUEST_REF = "IFO-2610-QA02";
const GUEST_TOKEN = `qa-${randomBytes(24).toString("base64url")}`;
const OWN_REF = "IFO-2610-QA01";
const OWN_TOKEN = `qa-${randomBytes(24).toString("base64url")}`;
let restore: () => Promise<void> = async () => {};
let admin: AdminLogin;
let productSlug = "";

test.beforeAll(async ({ browser, baseURL }) => {
  // Shared fixtures: wait for any other spec that rewrites them (tests/support/fixture-lock.ts).
  test.setTimeout(900_000);
  await acquireFixtureLock();
  await cleanupQa();
  restore = await applyCommerce();
  const [p] = await sql<{ slug: string }[]>`
    select p.slug from products p join variants v on v.product_id = p.id where v.sku = 'PH-CHARM-HEART-LILAC'`;
  productSlug = p!.slug;
  admin = await createAdminSession(browser, baseURL!, "owner");
});

test.afterAll(async () => {
  try {
    await cleanupQa();
    await cleanupQaAdmins(admin ? [admin.email] : []);
    await restore();
  } finally {
    await releaseFixtureLock();
  }
});

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  // Dialogs and drawers fade in: axe must not read colours mid-transition.
  await page.waitForTimeout(500);
  // Cache Components keeps previous routes mounted but hidden; let transitions and fonts finish.
  await page.evaluate(() => document.fonts.ready);
}

async function expectClean(page: Page, label: string, opts?: Parameters<typeof axeViolations>[1]) {
  await settle(page);
  const violations = await axeViolations(page, opts);
  expect(violations, `${label}\n${violations.join("\n")}`).toEqual([]);
}

const PUBLIC_PAGES: { name: string; path: string }[] = [
  { name: "home", path: "/home" },
  { name: "shop", path: "/shop" },
  { name: "vibe collection", path: "/vibes/gothic" },
  { name: "type collection", path: "/types/charms" },
  { name: "search results", path: "/search?q=heart" },
  { name: "search empty", path: "/search?q=zzzzqqq" },
  { name: "track", path: "/track" },
  { name: "help", path: "/help" },
  { name: "policy", path: "/policies/returns-refunds" },
  { name: "policies index", path: "/policies" },
  { name: "wishlist", path: "/wishlist" },
  { name: "cart (empty)", path: "/cart" },
  { name: "account login", path: "/account/login" },
  { name: "404", path: "/this-page-does-not-exist" },
];

test.describe("storefront, every vibe", () => {
  for (const vibe of VIBES) {
    test(`public pages in ${vibe}`, async ({ page }) => {
      for (const p of PUBLIC_PAGES) {
        await gotoVibe(page, p.path, vibe);
        await expectClean(page, `${p.name} (${p.path}) in ${vibe}`);
      }
    });

    test(`product page, cart, checkout and order pages in ${vibe}`, async ({
      page,
      context,
      baseURL,
    }) => {
      await gotoVibe(page, `/products/${productSlug}`, vibe);
      await expectClean(page, `product page in ${vibe}`);

      await seedCart(context, baseURL!);
      await gotoVibe(page, "/cart", vibe);
      await expect(page.getByTestId("cart-lines").or(page.locator("main")).first()).toBeVisible();
      await expectClean(page, `cart in ${vibe}`);

      await gotoVibe(page, "/checkout", vibe);
      await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false", {
        timeout: 30_000,
      });
      await expectClean(page, `checkout in ${vibe}`);

      await sql`delete from orders where ref = ${GUEST_REF}`;
      await insertQaOrder({
        ref: GUEST_REF,
        email: "qa-guest@example.com",
        token: GUEST_TOKEN,
        paymentMethod: "razorpay",
        status: "processing",
        paymentStatus: "paid",
        fulfillment: "shipped",
        shipment: {
          courier: "Delhivery",
          awb: "QA123456789",
          trackingUrl: "https://example.com/track/QA123456789",
        },
      });
      await gotoVibe(page, `/orders/${GUEST_REF}?t=${GUEST_TOKEN}`, vibe);
      await expect(page.getByTestId("order-status")).toBeVisible();
      await expectClean(page, `order page in ${vibe}`);
    });
  }

  test("open cart drawer in every vibe", async ({ page, context, baseURL }) => {
    await seedCart(context, baseURL!);
    for (const vibe of VIBES) {
      await gotoVibe(page, "/home", vibe);
      await settle(page);
      await page.locator('[data-testid="cart-button"]:visible').click();
      const drawer = page.getByRole("dialog").first();
      await expect(drawer).toBeVisible();
      await expectClean(page, `cart drawer in ${vibe}`);
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
    }
  });
});

test.describe("customer account", () => {
  test("login, overview, orders, order detail, addresses and profile", async ({
    page,
    context,
    baseURL,
  }) => {
    const userId = await signInCustomer(context, baseURL!, SHOPPER);
    await sql`delete from orders where ref = ${OWN_REF}`;
    await insertQaOrder({
      ref: OWN_REF,
      email: SHOPPER,
      userId,
      token: OWN_TOKEN,
      paymentMethod: "cod",
      status: "confirmed",
      paymentStatus: "cod_pending",
      fulfillment: "unfulfilled",
    });
    for (const vibe of VIBES) {
      for (const path of [
        "/account",
        "/account/orders",
        `/account/orders/${OWN_REF}`,
        "/account/addresses",
        "/account/profile",
      ] satisfies string[]) {
        await gotoVibe(page, path, vibe as Vibe);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectClean(page, `${path} in ${vibe}`);
      }
    }
  });
});

test.describe("open overlays", () => {
  test("search sheet, mobile menu, cancel and report dialogs", async ({
    page,
    context,
    baseURL,
    browser,
  }) => {
    for (const vibe of ["cute", "gothic"] as const) {
      await gotoVibe(page, "/home", vibe);
      await settle(page);
      await page
        .getByRole("button", { name: /Search/ })
        .first()
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectClean(page, `search sheet in ${vibe}`);
      await page.keyboard.press("Escape");
    }

    const phone = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const m = await phone.newPage();
    await gotoVibe(m, "/home", "funky");
    await settle(m);
    await m.getByRole("button", { name: "Open menu" }).click();
    await expect(m.getByRole("dialog", { name: "Menu" })).toBeVisible();
    await expectClean(m, "mobile menu");
    await phone.close();

    const userId = await signInCustomer(context, baseURL!, "qa-overlays@example.com");
    await sql`delete from orders where ref in ('IFO-2610-QA03','IFO-2610-QA04')`;
    await insertQaOrder({
      ref: "IFO-2610-QA03",
      email: "qa-overlays@example.com",
      userId,
      token: "qa-overlay-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      paymentMethod: "cod",
      status: "confirmed",
      paymentStatus: "cod_pending",
      fulfillment: "unfulfilled",
    });
    await insertQaOrder({
      ref: "IFO-2610-QA04",
      email: "qa-overlays@example.com",
      userId,
      token: "qa-overlay-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      paymentMethod: "razorpay",
      status: "processing",
      paymentStatus: "paid",
      fulfillment: "shipped",
      shipment: {
        courier: "Delhivery",
        awb: "QA987654321",
        trackingUrl: "https://example.com/t/QA987654321",
      },
    });
    await gotoVibe(page, "/account/orders/IFO-2610-QA03", "bold");
    await settle(page);
    await page.getByRole("button", { name: "Cancel order" }).click();
    await expect(page.getByRole("dialog", { name: "Cancel this order?" })).toBeVisible();
    await expectClean(page, "cancel dialog");
    await page.keyboard.press("Escape");

    await gotoVibe(page, "/account/orders/IFO-2610-QA04", "bold");
    await settle(page);
    await page.getByRole("button", { name: "Report a problem" }).click();
    await expect(page.getByRole("dialog", { name: "Report a problem" })).toBeVisible();
    await expectClean(page, "report-a-problem dialog");
    await page.keyboard.press("Escape");

    await gotoVibe(page, "/account/addresses", "gothic");
    await settle(page);
    await page.getByTestId("add-address").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectClean(page, "address dialog");
  });
});

const ADMIN_PAGES = [
  "/admin",
  "/admin/products",
  "/admin/products/new",
  "/admin/inventory",
  "/admin/collections",
  "/admin/orders",
  "/admin/discounts",
  "/admin/discounts/new",
  "/admin/support",
  "/admin/content",
  "/admin/faq",
  "/admin/policies",
  "/admin/settings",
  "/admin/users",
  "/admin/audit",
  "/admin/pincodes",
  "/admin/reports",
  "/admin/insights",
];

test.describe("admin", () => {
  test("every admin page", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: admin.storageState });
    const page = await context.newPage();
    const found: string[] = [];
    for (const path of ADMIN_PAGES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await settle(page);
      for (const v of await axeViolations(page)) found.push(`${path}: ${v}`);
    }
    await context.close();
    expect(found, found.join("\n")).toEqual([]);
  });

  test("admin order detail, policy editor and sign-in", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: admin.storageState });
    const page = await context.newPage();
    const [order] = await sql<{ id: string }[]>`select id from orders where ref = ${GUEST_REF}`;
    if (order) {
      await page.goto(`/admin/orders/${order.id}`);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expectClean(page, "admin order detail");
    }
    await page.goto("/admin/policies/shipping");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expectClean(page, "admin policy editor");
    await context.close();

    const anon = await browser.newContext({ baseURL });
    const login = await anon.newPage();
    await login.goto("/admin/login");
    await expectClean(login, "admin login");
    await anon.close();
  });
});
