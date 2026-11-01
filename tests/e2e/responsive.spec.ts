import { randomBytes } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { createAdminSession, cleanupQaAdmins, type AdminLogin } from "../support/admin";
import {
  applyCommerce,
  cleanupQa,
  insertQaOrder,
  seedCart,
  signInCustomer,
} from "../support/commerce";
import { sql } from "../support/db";
import { VIBES, gotoVibe } from "../support/vibes";
import { acquireFixtureLock, releaseFixtureLock } from "../support/fixture-lock";

/**
 * Mobile pass at 390 px (iPhone 14 class, touch): every page type, in every vibe, must
 *  - not scroll sideways (`scrollWidth <= innerWidth`),
 *  - keep primary tap targets (buttons, form controls, nav links) at least 44 x 44 CSS px,
 * and the product page's sticky add-to-cart bar must not hide content at the end of the page.
 *
 *   E2E_BASE_URL=http://localhost:3108 pnpm e2e tests/e2e/responsive.spec.ts --project=chromium-desktop
 */

test.describe.configure({ mode: "default" });
test.setTimeout(240_000);
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "viewport is set by the spec itself");
});
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});

const SHOPPER = "qa-responsive@example.com";
const GUEST_REF = "IFO-2610-QA12";
const OWN_REF = "IFO-2610-QA11";
const GUEST_TOKEN = `qa-${randomBytes(24).toString("base64url")}`;
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
  await page.evaluate(() => document.fonts.ready);
}

async function noHorizontalScroll(page: Page, label: string) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect
    .soft(scrollWidth, `${label}: page scrolls sideways (${scrollWidth} > ${innerWidth})`)
    .toBeLessThanOrEqual(innerWidth);
}

/**
 * Visible interactive elements smaller than `min` px on either side. Links that sit inside running text
 * (a paragraph, list item or table cell with other text) are exempt, as WCAG 2.5.8 allows; so are
 * screen-reader-only helpers such as the skip link while it is off screen.
 */
async function smallTargets(page: Page, min = 44): Promise<string[]> {
  return page.evaluate((limit) => {
    const out: string[] = [];
    const selector =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"]';
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (el.closest("[hidden], [aria-hidden='true'], [inert], nextjs-portal")) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      // Hidden vibe variants and previous routes kept mounted by Cache Components.
      if (el.getClientRects().length === 0) continue;
      let r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // A checkbox/radio hidden under its larger label is judged by the label.
      const label = el.closest("label");
      if (
        label &&
        (el.matches("input[type=checkbox], input[type=radio]") || style.opacity === "0")
      ) {
        r = label.getBoundingClientRect();
      }
      // Stretched links (`after:inset-0`) are tapped through their whole card.
      if (el.className.toString().includes("after:inset-0")) {
        const card = el.closest("article, li");
        if (card) r = card.getBoundingClientRect();
      }
      // The animated hero's moving tiles: decoration over the hero, paused by the Pause control, with the same
      // products reachable from the poster and the featured grid. Reported as a known issue, not asserted.
      if (el.classList.contains("stage-tile")) continue;
      if (el.matches("a[href]")) {
        // Inline link: nearest block-level ancestor holds more text than the link itself.
        let block: HTMLElement | null = el.parentElement;
        while (block && getComputedStyle(block).display === "inline") block = block.parentElement;
        const inline = style.display === "inline";
        const own =
          (block?.textContent ?? "").trim().length > (el.textContent ?? "").trim().length + 3;
        if (inline && own) continue;
      }
      if (el.classList.contains("sr-only") && !el.matches(":focus")) continue;
      if (r.right < 0 || r.bottom < 0) continue;
      if (r.width + 0.5 < limit || r.height + 0.5 < limit) {
        const name = (
          el.getAttribute("aria-label") ||
          el.textContent ||
          el.getAttribute("name") ||
          el.tagName
        )
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 40);
        out.push(
          `${el.tagName.toLowerCase()} "${name}" ${Math.round(r.width)}x${Math.round(r.height)}`,
        );
      }
    }
    return out;
  }, min);
}

async function check(page: Page, label: string) {
  await settle(page);
  await noHorizontalScroll(page, label);
  const small = await smallTargets(page);
  expect.soft(small, `${label}: tap targets under 44px\n${small.join("\n")}`).toEqual([]);
}

const PUBLIC_PAGES = [
  "/",
  "/shop",
  "/vibes/gothic",
  "/types/charms",
  "/search?q=heart",
  "/search?q=zzzzqqq",
  "/track",
  "/help",
  "/policies/shipping",
  "/policies",
  "/wishlist",
  "/cart",
  "/account/login",
  "/no-such-page",
];

test.describe("390px, every vibe", () => {
  for (const vibe of VIBES) {
    test(`public pages in ${vibe}`, async ({ page }) => {
      for (const path of PUBLIC_PAGES) {
        await gotoVibe(page, path, vibe);
        await check(page, `${path} in ${vibe}`);
      }
    });

    test(`product, cart, checkout and order in ${vibe}`, async ({ page, context, baseURL }) => {
      await gotoVibe(page, `/products/${productSlug}`, vibe);
      await check(page, `product in ${vibe}`);

      await seedCart(context, baseURL!);
      await gotoVibe(page, "/cart", vibe);
      await check(page, `cart in ${vibe}`);

      await gotoVibe(page, "/checkout", vibe);
      await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false", {
        timeout: 30_000,
      });
      await check(page, `checkout in ${vibe}`);

      await sql`delete from orders where ref = ${GUEST_REF}`;
      await insertQaOrder({
        ref: GUEST_REF,
        email: "qa-guest-responsive@example.com",
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
      await check(page, `order page in ${vibe}`);
    });
  }

  test("account pages", async ({ page, context, baseURL }) => {
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
    for (const path of [
      "/account",
      "/account/orders",
      `/account/orders/${OWN_REF}`,
      "/account/addresses",
      "/account/profile",
    ]) {
      await gotoVibe(page, path, "gothic");
      await check(page, path);
    }
  });
});

test.describe("product page sticky bar", () => {
  test("the bar stays on screen, is compact, and never covers the end of the page", async ({
    page,
  }) => {
    await gotoVibe(page, `/products/${productSlug}`, "bold");
    await settle(page);
    const button = page.getByTestId("add-to-cart");
    await expect(button).toBeVisible();
    const bar = button.locator("xpath=ancestor::div[contains(@class,'sticky')][1]");
    const viewport = page.viewportSize()!;

    // Scrolled into the details the bar is pinned to the bottom edge and takes at most a quarter of the screen.
    await page.evaluate(() => window.scrollTo(0, 700));
    await page.waitForTimeout(300);
    const pinned = (await bar.boundingBox())!;
    expect(pinned.y + pinned.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(pinned.height).toBeLessThanOrEqual(viewport.height * 0.25);

    // At the very end of the page nothing sits underneath it.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const covered = await page.evaluate(() => {
      const btn = document.querySelector<HTMLElement>('[data-testid="add-to-cart"]');
      let barEl = btn?.parentElement ?? null;
      while (barEl && !barEl.className.toString().includes("sticky")) barEl = barEl.parentElement;
      if (!barEl) return [];
      const b = barEl.getBoundingClientRect();
      const hits: string[] = [];
      const candidates = document.querySelectorAll<HTMLElement>(
        "main a[href], main button, main p, main h2, main h3, footer a[href], footer p",
      );
      for (const el of Array.from(candidates)) {
        if (barEl.contains(el) || el.contains(barEl) || el.getClientRects().length === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const overlap = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
        const across = Math.min(r.right, b.right) - Math.max(r.left, b.left);
        if (overlap > 2 && across > 2)
          hits.push((el.textContent ?? el.tagName).trim().slice(0, 40));
      }
      return hits;
    });
    expect(covered, "content hidden under the sticky bar at the end of the page").toEqual([]);
  });
});

test.describe("admin at 390px", () => {
  test("no sideways scroll on the main admin pages", async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      storageState: admin.storageState,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    for (const path of [
      "/admin",
      "/admin/orders",
      "/admin/products",
      "/admin/inventory",
      "/admin/support",
      "/admin/content",
      "/admin/settings",
      "/admin/pincodes",
      "/admin/reports",
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await settle(page);
      await noHorizontalScroll(page, `admin ${path}`);
    }
    await context.close();
  });
});
