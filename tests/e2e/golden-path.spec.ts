import { randomBytes } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { createAdminSession, cleanupQaAdmins, type AdminLogin } from "../support/admin";
import {
  QA_EMAIL_PREFIX,
  applyCommerce,
  cleanupQa,
  PINCODE_OK,
  seedCart,
} from "../support/commerce";
import { sql } from "../support/db";

/**
 * The golden paths, end to end through the real UI. The checkout, order and tracking specs cover each
 * screen in depth; this file chains them the way a shopper and the shop owner actually use the store:
 *
 *  1. browse -> product page -> add to cart -> cart -> checkout (COD) -> order page -> track
 *  2. prepaid through the dev mock checkout -> confirmed -> customer cancels -> refund shown
 *  3. admin packs and ships with an AWB -> the customer sees "Shipped" on /track
 *
 * Needs the dev server (the payment mock only exists outside production builds) and the seeded dev database:
 *
 *   E2E_BASE_URL=http://localhost:3108 pnpm e2e tests/e2e/golden-path.spec.ts --project=chromium-desktop
 *
 * The fixtures it writes (qa- e-mails, the commerce settings, stock) are restored afterwards.
 */

test.describe.configure({ mode: "default" });
test.setTimeout(180_000);
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "run with --project=chromium-desktop");
});

let restore: () => Promise<void> = async () => {};
let admin: AdminLogin;

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  await cleanupQa();
  restore = await applyCommerce();
  admin = await createAdminSession(browser, baseURL!, "owner");
});

test.afterAll(async () => {
  await cleanupQa();
  await cleanupQaAdmins();
  await restore();
});

const newEmail = () => `${QA_EMAIL_PREFIX}golden-${randomBytes(4).toString("hex")}@example.com`;
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const payButton = (page: Page) => page.getByRole("button", { name: /^Pay .* securely$/ });
const codButton = (page: Page) => page.getByRole("button", { name: /^Place COD order/ });

async function openCheckout(page: Page) {
  await page.goto("/checkout");
  await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false", {
    timeout: 30_000,
  });
}

async function fillCheckout(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mobile number").fill("98765 43210");
  await page.getByLabel("Pincode").fill(PINCODE_OK);
  await expect(page.getByLabel("City")).not.toHaveValue("");
  await page.getByLabel("Full name").fill("Asha Rao");
  await page.getByLabel("House or flat number and street").fill("12 Marine Drive");
  await page.getByRole("checkbox", { name: /I have read and agree/ }).check();
  await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false");
}

async function track(page: Page, ref: string, email: string) {
  await page.goto("/track");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Order reference").fill(ref);
  await page.getByLabel("Email or mobile number").fill(email);
  await page.getByRole("button", { name: "Track order" }).click();
}

test("browse, product page, add to cart, checkout with cash on delivery, order page, track", async ({
  page,
}) => {
  const email = newEmail();

  // Browse: the shop lists products; open the Heart charm.
  await page.goto("/shop?vibe=cute");
  const card = page
    .locator('[data-testid="product-card"]:visible', { hasText: "Heart charm" })
    .first();
  await expect(card).toBeVisible();
  await card.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/products\/heart-charm/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Heart charm");
  // Price wording and policy links are visible before anything is bought.
  await expect(page.getByText(/incl\. of all taxes/i).first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Returns and refunds policy" }).first(),
  ).toBeVisible();

  // Add to cart: the toast confirms it, the header count follows.
  await page.waitForLoadState("networkidle");
  await page.getByTestId("add-to-cart").click();
  await expect(page.locator('[data-testid="cart-count"]:visible')).toHaveText("1");

  // Cart page: the total includes GST and the shipping estimate.
  await page.goto("/cart");
  await expect(page.getByTestId("cart-totals")).toBeVisible();
  await expect(page.getByTestId("cart-gst")).toContainText("GST");
  await page
    .getByRole("link", { name: /Checkout|Continue to checkout/ })
    .first()
    .click();

  // Checkout with COD: the fee is its own line and the button states the amount.
  await expect(page).toHaveURL(/\/checkout/);
  await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false", {
    timeout: 30_000,
  });
  await fillCheckout(page, email);
  await page.getByRole("radio", { name: /Cash on delivery/ }).check();
  await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false");
  await expect(tid(page, "amount-cod-fee")).toBeVisible();
  await expect(codButton(page)).toContainText("₹");
  const total = (await tid(page, "amount-total").textContent())!.trim();
  await codButton(page).click();

  // Order page.
  await expect(page).toHaveURL(/\/orders\/IFO-[0-9A-Z-]+\?t=/);
  await expect(page.getByTestId("order-status")).toHaveText("Confirmed");
  await expect(tid(page, "amount-total")).toHaveText(total);
  await expect(page.getByTestId("payment-line")).toContainText(`pay ${total} when it arrives`);
  const ref = (await page.getByTestId("order-ref").textContent())!.trim();

  // Track by reference + email.
  await track(page, ref, email);
  await expect(page.getByTestId("track-ref")).toHaveText(ref);
  await expect(page.getByTestId("track-status")).toHaveText("Confirmed");
  await expect(page.getByTestId("no-shipment")).toContainText("hasn't shipped yet");
});

test("prepaid through the dev mock checkout, then the customer cancels and sees the refund", async ({
  page,
  context,
  baseURL,
}) => {
  const email = newEmail();
  await seedCart(context, baseURL!, 1);
  await openCheckout(page);
  await fillCheckout(page, email);
  await expect(payButton(page)).toBeVisible();
  await payButton(page).click();
  const mock = page.getByRole("dialog", { name: "Test payment (dev mock)" });
  await expect(mock).toBeVisible();
  await mock.getByTestId("mock-success").click();

  await expect(page).toHaveURL(/\/orders\/IFO-[0-9A-Z-]+\?t=/);
  await expect(page.getByTestId("order-status")).toHaveText("Confirmed");
  await expect(page.getByTestId("payment-line")).toHaveText("Paid online");
  await expect(
    page.getByTestId("order-actions").getByRole("link", { name: "Download invoice" }),
  ).toBeVisible();

  // Cancel: the dialog promises a full refund to the original payment method.
  await page.getByTestId("order-actions").getByRole("button", { name: "Cancel order" }).click();
  const dialog = page.getByRole("dialog", { name: "Cancel this order?" });
  await expect(dialog).toContainText("refund the full");
  await dialog.getByTestId("cancel-confirm").click();

  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByTestId("order-status")).toHaveText(/Cancelled|Refunded/, {
    timeout: 30_000,
  });
  await expect(page.getByTestId("payment-line")).toContainText(/refund/i);
  await expect(page.getByTestId("order-headline")).toContainText(/cancelled|refunded/i);

  // The database agrees: one refund row for the full amount.
  const rows = await sql<{ amount_paise: string; total_paise: string }[]>`
    select r.amount_paise, o.total_paise from refunds r join orders o on o.id = r.order_id where o.email = ${email}`;
  expect(rows).toHaveLength(1);
  expect(Number(rows[0]!.amount_paise)).toBe(Number(rows[0]!.total_paise));
});

test("the admin packs and ships with an AWB, and the customer sees Shipped on /track", async ({
  page,
  context,
  baseURL,
  browser,
}) => {
  // A COD order placed through the checkout.
  const email = newEmail();
  await seedCart(context, baseURL!, 1);
  await openCheckout(page);
  await fillCheckout(page, email);
  await page.getByRole("radio", { name: /Cash on delivery/ }).check();
  await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false");
  await codButton(page).click();
  await expect(page).toHaveURL(/\/orders\/IFO-/);
  const ref = (await page.getByTestId("order-ref").textContent())!.trim();
  const [row] = await sql<{ id: string }[]>`select id from orders where ref = ${ref}`;

  // The admin works the order.
  const adminContext = await browser.newContext({ baseURL, storageState: admin.storageState });
  const a = await adminContext.newPage();
  await a.goto(`/admin/orders/${row!.id}`);
  await expect(a.getByRole("heading", { level: 1 }).first()).toContainText(ref);
  await a.getByRole("button", { name: "Mark packed" }).click();
  await expect(a.getByText(/packed/i).first()).toBeVisible();

  await track(page, ref, email);
  await expect(page.getByTestId("track-status")).toHaveText("Packed");

  await a.getByRole("button", { name: "Add shipment" }).click();
  const dialog = a.getByRole("dialog", { name: "Add shipment" });
  await dialog.getByRole("combobox", { name: /Courier/ }).click();
  await a.getByRole("option", { name: "Delhivery" }).click();
  await dialog.getByLabel("AWB / tracking number").fill("QAGOLD0001");
  await dialog.getByRole("button", { name: "Mark shipped" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await adminContext.close();

  // The customer sees it.
  await track(page, ref, email);
  await expect(page.getByTestId("track-status")).toHaveText("Shipped");
  await expect(page.getByTestId("shipment-courier")).toHaveText("Delhivery");
  await expect(page.getByTestId("shipment-awb")).toHaveText("QAGOLD0001");
});
