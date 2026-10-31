import { randomBytes } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  PINCODE_OK,
  applyCommerce,
  applyCustomerSession,
  cleanupQa,
  createCustomerSession,
  insertQaOrder,
  seedCart,
  type CustomerSession,
} from "../support/commerce";
import { sql } from "../support/db";
import { VIBES, gotoVibe, type Vibe } from "../support/vibes";

import { FROZEN_NOW, snap, visualEnabled } from "./helpers";

/**
 * Storefront screenshots: every page type x five vibes x the width of the project (390, 768, 1440).
 *
 * Deterministic by construction: reduced motion (the hero is its poster), a frozen clock, seeded catalogue,
 * fixed orders with fixed dates and a fixed guest token, animations disabled, and the few regions that
 * depend on today's date or on live stock masked. See tests/visual/README.md.
 */

test.skip(!visualEnabled, "set E2E_VISUAL=1 (see tests/visual/README.md)");
test.describe.configure({ mode: "serial" });

const SHOPPER = "qa-visual@example.com";
const OWN_REF = "IFO-2610-QA21";
const GUEST_REF = "IFO-2610-QA22";
const CANCELLED_REF = "IFO-2610-QA23";
const OWN_TOKEN = `qa-${randomBytes(24).toString("base64url")}`;
const GUEST_TOKEN = `qa-${randomBytes(24).toString("base64url")}`;
const GUEST_EMAIL = "qa-visual-guest@example.com";

let restore: () => Promise<void> = async () => {};
let customer: CustomerSession;
let productSlug = "";

test.beforeAll(async () => {
  await cleanupQa();
  restore = await applyCommerce();
  const [p] = await sql<{ slug: string }[]>`
    select p.slug from products p join variants v on v.product_id = p.id where v.sku = 'PH-CHARM-HEART-LILAC'`;
  productSlug = p!.slug;
  customer = await createCustomerSession(SHOPPER);
  await insertQaOrder({
    ref: OWN_REF,
    email: SHOPPER,
    userId: customer.userId,
    token: OWN_TOKEN,
    paymentMethod: "cod",
    status: "confirmed",
    paymentStatus: "cod_pending",
    fulfillment: "unfulfilled",
  });
  await insertQaOrder({
    ref: GUEST_REF,
    email: GUEST_EMAIL,
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
  await insertQaOrder({
    ref: CANCELLED_REF,
    email: GUEST_EMAIL,
    token: GUEST_TOKEN,
    paymentMethod: "razorpay",
    status: "cancelled",
    paymentStatus: "refunded",
    fulfillment: "unfulfilled",
  });
});

test.afterAll(async () => {
  await cleanupQa();
  await restore();
});

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FROZEN_NOW);
});

/** Regions whose text depends on the real date or live stock: painted over, but their box is still compared. */
const dynamic = (page: Page) => [
  page.getByTestId("delivery-estimate"),
  page.getByTestId("stock-status"),
  page.locator("[data-visual-mask]"),
  page.locator("time"),
];

interface Shot {
  name: string;
  path: () => string;
  /** Runs after navigation, before the screenshot. */
  prepare?: (page: Page) => Promise<void>;
  /** Needs a cart with items. */
  cart?: boolean;
  /** Needs the customer signed in. */
  signedIn?: boolean;
}

const waitForReview = async (page: Page) => {
  await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false", {
    timeout: 30_000,
  });
};

const SHOTS: Shot[] = [
  { name: "home", path: () => "/" },
  { name: "shop", path: () => "/shop" },
  { name: "vibe-collection", path: () => "/vibes/gothic" },
  { name: "type-collection", path: () => "/types/charms" },
  { name: "product", path: () => `/products/${productSlug}` },
  { name: "search-results", path: () => "/search?q=heart" },
  { name: "search-empty", path: () => "/search?q=zzzzqqq" },
  { name: "cart-empty", path: () => "/cart" },
  { name: "cart-filled", path: () => "/cart", cart: true },
  {
    name: "checkout",
    path: () => "/checkout",
    cart: true,
    prepare: async (page) => {
      await waitForReview(page);
      await page.getByLabel("Email").fill("qa-visual-checkout@example.com");
      await page.getByLabel("Mobile number").fill("98765 43210");
      await page.getByLabel("Pincode").fill(PINCODE_OK);
      await expect(page.getByLabel("City")).not.toHaveValue("");
      await page.getByLabel("Full name").fill("Asha Rao");
      await page.getByLabel("House or flat number and street").fill("12 Marine Drive");
      await waitForReview(page);
    },
  },
  { name: "order-confirmation", path: () => `/orders/${OWN_REF}?t=${OWN_TOKEN}` },
  { name: "order-shipped", path: () => `/orders/${GUEST_REF}?t=${GUEST_TOKEN}` },
  { name: "order-cancelled", path: () => `/orders/${CANCELLED_REF}?t=${GUEST_TOKEN}` },
  { name: "track", path: () => "/track" },
  {
    name: "track-result",
    path: () => "/track",
    prepare: async (page) => {
      await page.getByLabel("Order reference").fill(GUEST_REF);
      await page.getByLabel("Email or mobile number").fill(GUEST_EMAIL);
      await page.getByRole("button", { name: "Track order" }).click();
      await expect(page.getByTestId("track-status")).toBeVisible();
    },
  },
  { name: "help", path: () => "/help" },
  { name: "policy", path: () => "/policies/returns-refunds" },
  { name: "wishlist", path: () => "/wishlist" },
  { name: "account-login", path: () => "/account/login" },
  { name: "account-overview", path: () => "/account", signedIn: true },
  { name: "account-orders", path: () => "/account/orders", signedIn: true },
  { name: "account-order", path: () => `/account/orders/${OWN_REF}`, signedIn: true },
  { name: "account-addresses", path: () => "/account/addresses", signedIn: true },
  { name: "account-profile", path: () => "/account/profile", signedIn: true },
  { name: "not-found", path: () => "/this-page-does-not-exist" },
];

for (const shot of SHOTS) {
  test.describe(shot.name, () => {
    for (const vibe of VIBES) {
      test(`${vibe}`, async ({ page, context, baseURL }) => {
        if (shot.cart) await seedCart(context, baseURL!, 2);
        if (shot.signedIn) await applyCustomerSession(context, baseURL!, customer);
        await gotoVibe(page, shot.path(), vibe as Vibe);
        await shot.prepare?.(page);
        await snap(page, `${shot.name}-${vibe}`, { mask: dynamic(page) });
      });
    }
  });
}
