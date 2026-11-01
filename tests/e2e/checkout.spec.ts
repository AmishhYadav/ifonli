import { randomBytes } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { config } from "dotenv";
import postgres from "postgres";
import { acquireFixtureLock, releaseFixtureLock } from "../support/fixture-lock";

/**
 * Checkout, payment, order page and tracking e2e. Needs the dev server (the payment mock only exists
 * outside production builds) and the local dev database with the product seed:
 *
 *   NEXT_DIST_DIR=.next-b pnpm exec next dev -p 3105
 *   E2E_BASE_URL=http://localhost:3105 pnpm e2e tests/e2e/checkout.spec.ts --project=chromium-desktop
 *
 * Setup writes commerce settings and pincode rows through SQL and restores them afterwards; the orders
 * it places (e2e-checkout-*@example.com) and their stock movements are removed again. Run it on one
 * project at a time: it owns those rows while it runs.
 */

config({ path: ".env.local", quiet: true });

const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL || "", {
  max: 2,
  onnotice: () => {},
});

const TEST_SETTINGS: Record<string, unknown> = {
  state: "Maharashtra",
  flat_fee: 5000,
  free_threshold: 50000,
  zone_overrides: {},
  serviceability_mode: "all_india",
  processing_days: 1,
  delivery_estimates_by_zone: {
    metro_region: { minDays: 2, maxDays: 4 },
    rest_of_india: { minDays: 3, maxDays: 6 },
  },
  cod_enabled: true,
  cod_fee: 4000,
  cod_max_order_value: 500000,
  cod_excluded_pincodes: [],
  default_gst_rate_bp: 1800,
  shipping_tax_rule: "dominant_line_rate",
  reservation_ttl_minutes: 15,
  max_qty_per_line: 10,
};

const PINCODE_OK = "400001"; // Mumbai: serviceable, COD allowed
const PINCODE_NO_COD = "411001"; // Pune: COD switched off for the test
const PINCODE_UNSERVICEABLE = "744101"; // South Andaman: switched to unserviceable for the test
const PINCODE_UNKNOWN = "123456"; // valid shape, not in the directory
const SKU = "PH-CHARM-HEART-LILAC"; // Rs 179
const EMAIL_PREFIX = "e2e-checkout-";

interface Snapshot {
  settings: { key: string; value: unknown; is_placeholder: boolean }[];
  pincodes: { pincode: string; cod_allowed: boolean; serviceable: boolean }[];
  variantId: string;
  stock: number;
}
let snapshot: Snapshot;

const newEmail = () => `${EMAIL_PREFIX}${randomBytes(4).toString("hex")}@example.com`;

async function deleteTestOrders() {
  const ids = sql`(select id from orders where email like ${EMAIL_PREFIX + "%"})`;
  await sql`delete from notification_outbox where order_id in ${ids}`;
  await sql`delete from inventory_movements where order_id in ${ids}`;
  await sql`delete from invoices where order_id in ${ids}`;
  await sql`delete from refunds where order_id in ${ids}`;
  await sql`delete from payments where order_id in ${ids}`;
  await sql`delete from orders where email like ${EMAIL_PREFIX + "%"}`;
}

test.beforeAll(async () => {
  // Shared fixtures: wait for any other spec that rewrites them (tests/support/fixture-lock.ts).
  test.setTimeout(900_000);
  await acquireFixtureLock();
  const keys = Object.keys(TEST_SETTINGS);
  const settingRows = await sql<
    Snapshot["settings"]
  >`select key, value, is_placeholder from settings where key in ${sql(keys)}`;
  const pincodeRows = await sql<Snapshot["pincodes"]>`
    select pincode, cod_allowed, serviceable from pincodes where pincode in ${sql([PINCODE_OK, PINCODE_NO_COD, PINCODE_UNSERVICEABLE])}`;
  const [variant] = await sql<
    { id: string; stock_on_hand: number }[]
  >`select id, stock_on_hand from variants where sku = ${SKU}`;
  if (!variant) throw new Error(`Seed variant ${SKU} not found: run pnpm db:seed-products`);
  snapshot = {
    settings: settingRows,
    pincodes: pincodeRows,
    variantId: variant.id,
    stock: variant.stock_on_hand,
  };

  for (const [key, value] of Object.entries(TEST_SETTINGS)) {
    await sql`
      insert into settings (key, value, is_placeholder) values (${key}, ${sql.json(value as never)}, false)
      on conflict (key) do update set value = excluded.value, is_placeholder = false`;
  }
  await sql`update pincodes set cod_allowed = true, serviceable = true where pincode = ${PINCODE_OK}`;
  await sql`update pincodes set cod_allowed = false, serviceable = true where pincode = ${PINCODE_NO_COD}`;
  await sql`update pincodes set serviceable = false where pincode = ${PINCODE_UNSERVICEABLE}`;
  await sql`update variants set stock_on_hand = 200 where id = ${variant.id}`;
  await sql`delete from rate_limits where key like any(array['pincode:%','checkout:%','track:%','payverify:%','payretry:%'])`;
  await deleteTestOrders();
});

test.afterAll(async () => {
  try {
    await deleteTestOrders();
    const had = new Set(snapshot.settings.map((s) => s.key));
    for (const key of Object.keys(TEST_SETTINGS)) {
      if (!had.has(key)) await sql`delete from settings where key = ${key}`;
    }
    for (const s of snapshot.settings) {
      await sql`update settings set value = ${sql.json(s.value as never)}, is_placeholder = ${s.is_placeholder} where key = ${s.key}`;
    }
    for (const p of snapshot.pincodes) {
      await sql`update pincodes set cod_allowed = ${p.cod_allowed}, serviceable = ${p.serviceable} where pincode = ${p.pincode}`;
    }
    await sql`update variants set stock_on_hand = ${snapshot.stock} where id = ${snapshot.variantId}`;
    await sql`delete from carts where token like 'e2e-%'`;
    await sql.end();
  } finally {
    await releaseFixtureLock();
  }
});

// The suite mutates shared rows and the payment mock lives in the dev server: one desktop project, in order.
test.describe.configure({ mode: "serial" });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "run with --project=chromium-desktop");
});
test.setTimeout(120_000);

/** A guest cart with `qty` of the test product, wired to the browser through the `cart_token` cookie. */
async function seedCart(context: BrowserContext, baseURL: string, qty = 2) {
  const token = `e2e-${randomBytes(18).toString("base64url")}`;
  const [cart] = await sql<{ id: string }[]>`
    insert into carts (token, expires_at) values (${token}, now() + interval '1 day') returning id`;
  await sql`insert into cart_items (cart_id, variant_id, qty) values (${cart!.id}, ${snapshot.variantId}, ${qty})`;
  await context.addCookies([{ name: "cart_token", value: token, url: baseURL }]);
}

async function openCheckout(page: Page, path = "/checkout") {
  await page.goto(path);
  // The review block turns aria-busy=false once the page has hydrated and the first live quote is back.
  await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false", {
    timeout: 30_000,
  });
}

interface FillOptions {
  email?: string;
  pincode?: string;
  ack?: boolean;
}

async function fillCheckout(
  page: Page,
  { email = newEmail(), pincode = PINCODE_OK, ack = true }: FillOptions = {},
) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mobile number").fill("98765 43210");
  await page.getByLabel("Pincode").fill(pincode);
  await expect(page.getByLabel("City")).not.toHaveValue("");
  await page.getByLabel("Full name").fill("Asha Rao");
  await page.getByLabel("House or flat number and street").fill("12 Marine Drive");
  if (ack) await page.getByRole("checkbox", { name: /I have read and agree/ }).check();
  await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false");
  return email;
}

const payButton = (page: Page) => page.getByRole("button", { name: /^Pay .* securely$/ });
const codButton = (page: Page) => page.getByRole("button", { name: /^Place COD order/ });

/**
 * Cache Components keeps the previous route mounted but hidden after a client navigation, so after
 * checkout -> order page both pages' test ids exist; only the visible one counts.
 */
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

/** The amounts the review and the confirmation must agree on. */
async function readAmounts(page: Page) {
  const read = async (id: string) => (await tid(page, id).textContent())?.trim() ?? "";
  return {
    subtotal: await read("amount-subtotal"),
    shipping: await read("amount-shipping"),
    total: await read("amount-total"),
    gst: await read("amount-gst"),
  };
}

test.describe("checkout form", () => {
  test("an empty cart shows an empty state, not the form", async ({ page }) => {
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
    await expect(page.getByTestId("checkout-form")).toHaveCount(0);
  });

  test("is not indexable", async ({ page, context, baseURL }) => {
    await seedCart(context, baseURL!);
    await page.goto("/checkout");
    await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);
  });

  test("submitting an empty form lists every problem, focuses the first and requires the policy tick", async ({
    page,
    context,
    baseURL,
  }) => {
    await seedCart(context, baseURL!);
    await openCheckout(page);

    await expect(page.getByRole("checkbox", { name: /I have read and agree/ })).not.toBeChecked();
    await payButton(page).click();

    const summary = page.getByTestId("error-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("Enter your email address");
    await expect(summary).toContainText("Enter your mobile number");
    await expect(summary).toContainText("Enter a valid 6-digit pincode");
    await expect(summary).toContainText("Enter the recipient's full name");
    await expect(summary).toContainText("Enter your house or flat number and street");
    await expect(summary).toContainText("Please tick the box to confirm");
    await expect(summary).toHaveAttribute("role", "alert");
    await expect(page.getByLabel("Email")).toBeFocused();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Email")).toHaveAccessibleDescription(
      /Your order confirmation|Enter your email address/,
    );
  });

  test("a malformed email and phone get specific messages", async ({ page, context, baseURL }) => {
    await seedCart(context, baseURL!);
    await openCheckout(page);
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Mobile number").fill("12345");
    await payButton(page).click();
    await expect(page.getByTestId("error-summary")).toContainText(
      "Enter a valid email address, like name@example.com",
    );
    await expect(page.getByTestId("error-summary")).toContainText(
      "Enter a 10-digit Indian mobile number",
    );
  });

  test("the policy acknowledgement is required before an order is placed", async ({
    page,
    context,
    baseURL,
  }) => {
    await seedCart(context, baseURL!);
    await openCheckout(page);
    await fillCheckout(page, { ack: false });
    await payButton(page).click();
    await expect(page.getByTestId("error-summary")).toContainText("Please tick the box to confirm");
    await expect(page.getByRole("checkbox", { name: /I have read and agree/ })).toBeFocused();
    await expect(page).toHaveURL(/\/checkout(\?|$)/);
    // The three policies are linked from the acknowledgement.
    for (const href of ["/policies/returns-refunds", "/policies/terms", "/policies/privacy"]) {
      await expect(page.getByTestId("review").locator(`a[href="${href}"]`)).toHaveAttribute(
        "target",
        "_blank",
      );
    }
  });

  test("an unknown or unserviceable pincode says so and blocks the order", async ({
    page,
    context,
    baseURL,
  }) => {
    await seedCart(context, baseURL!);
    await openCheckout(page);

    await page.getByLabel("Pincode").fill("12ab34");
    await expect(page.getByLabel("Pincode")).toHaveValue("1234");

    await page.getByLabel("Pincode").fill(PINCODE_UNKNOWN);
    await expect(page.getByText("We couldn't find that pincode")).toBeVisible();

    await page.getByLabel("Pincode").fill(PINCODE_UNSERVICEABLE);
    await expect(
      page.getByText(`Sorry, we can't deliver to ${PINCODE_UNSERVICEABLE} yet.`).first(),
    ).toBeVisible();

    await fillCheckout(page, { pincode: PINCODE_UNSERVICEABLE });
    await payButton(page).click();
    await expect(page.getByLabel("Pincode")).toBeFocused();
    await expect(page).toHaveURL(/\/checkout(\?|$)/);
  });

  test("a valid pincode fills city and state and shows the delivery estimate", async ({
    page,
    context,
    baseURL,
  }) => {
    await seedCart(context, baseURL!);
    await openCheckout(page);
    await page.getByLabel("Pincode").fill(PINCODE_OK);
    await expect(page.getByLabel("City")).toHaveValue("Mumbai");
    await expect(page.getByLabel("State")).toHaveValue("Maharashtra");
    await expect(page.getByText("We deliver to Mumbai, Maharashtra.")).toBeVisible();
    await expect(page.getByTestId("shipping-option")).toContainText(
      /Estimated delivery \d+ \w+ to \d+ \w+/,
    );
    // Rs 358 is below the Rs 500 free-shipping line: Rs 50 shipping, no COD fee on the prepaid total.
    await expect(page.getByTestId("amount-shipping")).toHaveText("₹50");
    await expect(page.getByTestId("amount-total")).toHaveText("₹408");
    await expect(page.getByTestId("amount-cod-fee")).toHaveCount(0);
    await expect(page.getByTestId("amount-discount")).toHaveCount(0);
    await expect(page.getByTestId("amount-gst")).toContainText("Includes ₹");
  });

  test("COD is offered, with its fee as its own line, only where it is allowed", async ({
    page,
    context,
    baseURL,
  }) => {
    await seedCart(context, baseURL!);
    await openCheckout(page);

    // Before a pincode there is no COD option.
    await expect(page.getByRole("radio", { name: /Cash on delivery/ })).toHaveCount(0);

    await page.getByLabel("Pincode").fill(PINCODE_NO_COD);
    await expect(page.getByTestId("cod-unavailable")).toBeVisible();
    await expect(page.getByRole("radio", { name: /Cash on delivery/ })).toHaveCount(0);

    await page.getByLabel("Pincode").fill(PINCODE_OK);
    const cod = page.getByRole("radio", { name: /Cash on delivery/ });
    await expect(cod).toBeVisible();
    await cod.check();
    await expect(page.getByTestId("amount-cod-fee")).toHaveText("₹40");
    await expect(page.getByTestId("amount-total")).toHaveText("₹448");
    await expect(codButton(page)).toHaveText("Place COD order ₹448");

    // Moving to a pincode without COD drops the choice back to online payment, and says so.
    await page.getByLabel("Pincode").fill(PINCODE_NO_COD);
    await expect(page.getByRole("radio", { name: /Pay online/ })).toBeChecked();
    await expect(page.getByText("We've switched you to online payment")).toBeVisible();
    await expect(page.getByTestId("amount-cod-fee")).toHaveCount(0);
    await expect(payButton(page)).toHaveText("Pay ₹408 securely");
  });
});

test.describe("payment and order page", () => {
  test("prepaid: mock success confirms the order and the amounts match the review", async ({
    page,
    context,
    baseURL,
  }) => {
    await seedCart(context, baseURL!);
    await openCheckout(page);
    const email = await fillCheckout(page);
    const review = await readAmounts(page);
    expect(review.total).toBe("₹408");

    await payButton(page).click();
    const dialog = page.getByRole("dialog", { name: "Test payment (dev mock)" });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("mock-success").click();

    await expect(page).toHaveURL(/\/orders\/IFO-[0-9A-Z-]+\?t=/);
    await expect(page.getByTestId("order-status")).toHaveText("Confirmed");
    await expect(page.getByTestId("order-headline")).toHaveText(
      "Thank you, your order is confirmed",
    );
    await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);
    expect(await readAmounts(page)).toEqual(review);
    await expect(page.getByTestId("payment-line")).toHaveText("Paid online");
    await expect(page.getByTestId("order-address")).toContainText("12 Marine Drive");
    await expect(page.getByTestId("order-address")).toContainText("Mumbai, Maharashtra - 400001");
    await expect(tid(page, "timeline")).toContainText("Order confirmed");
    await expect(tid(page, "order-lines")).toContainText("Heart charm");
    const actions = page.getByTestId("order-actions");
    await expect(actions.getByRole("link", { name: "Download invoice" })).toHaveAttribute(
      "href",
      /\/api\/orders\/IFO-[0-9A-Z-]+\/invoice\?t=/,
    );
    await expect(actions.getByRole("button", { name: "Cancel order" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Report a problem" })).toBeVisible();
    await expect(actions.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      /\/account\/login\?email=/,
    );
    expect(email).toContain(EMAIL_PREFIX);
  });

  test("prepaid: a failed payment can be retried, a dismissed one too", async ({
    page,
    context,
    baseURL,
  }) => {
    await seedCart(context, baseURL!);
    await openCheckout(page);
    await fillCheckout(page);
    await payButton(page).click();

    const dialog = page.getByRole("dialog", { name: "Test payment (dev mock)" });
    await dialog.getByTestId("mock-failure").click();
    const status = page.getByTestId("payment-status");
    await expect(status).toContainText("Payment not completed");
    await expect(page.getByLabel("Email")).toBeDisabled();

    await page.getByTestId("payment-retry").click();
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("mock-dismiss").click();
    await expect(status).toContainText("Payment not completed");

    await page.getByTestId("payment-retry").click();
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("mock-success").click();
    await expect(page).toHaveURL(/\/orders\/IFO-/);
    await expect(page.getByTestId("order-status")).toHaveText("Confirmed");
  });

  test("an unpaid order's page offers Retry and confirms after payment", async ({
    page,
    context,
    baseURL,
  }) => {
    await seedCart(context, baseURL!);
    await openCheckout(page);
    await fillCheckout(page);
    await payButton(page).click();
    const dialog = page.getByRole("dialog", { name: "Test payment (dev mock)" });
    await dialog.getByTestId("mock-dismiss").click();
    await expect(page.getByTestId("payment-status")).toContainText("Payment not completed");

    // The order's own page (the `?t=` link) offers the same Retry.
    await page.getByRole("link", { name: "View order" }).click();
    await expect(page).toHaveURL(/\/orders\/IFO-[0-9A-Z-]+\?t=/);
    await expect(page.getByTestId("order-status")).toHaveText("Payment pending");
    await expect(tid(page, "pay-now")).toContainText("don't pay again");
    await tid(page, "payment-retry").click();
    await dialog.getByTestId("mock-success").click();
    await expect(page.getByTestId("order-status")).toHaveText("Confirmed");
    await expect(tid(page, "pay-now")).toHaveCount(0);
  });

  test("COD: placing the order goes straight to the confirmation with the COD fee", async ({
    page,
    context,
    baseURL,
  }) => {
    await seedCart(context, baseURL!);
    await openCheckout(page);
    await fillCheckout(page);
    await page.getByRole("radio", { name: /Cash on delivery/ }).check();
    await expect(page.getByTestId("amount-total")).toHaveText("₹448");
    await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false"); // GST follows the live quote
    const review = await readAmounts(page);

    await codButton(page).click();
    await expect(page).toHaveURL(/\/orders\/IFO-[0-9A-Z-]+\?t=/);
    await expect(page.getByTestId("order-status")).toHaveText("Confirmed");
    await expect(page.getByTestId("payment-line")).toContainText(
      "Cash on delivery: pay ₹448 when it arrives",
    );
    await expect(tid(page, "amount-cod-fee")).toHaveText("₹40");
    expect(await readAmounts(page)).toEqual(review);
  });

  test("the order page needs the token", async ({ page, context, baseURL }) => {
    await seedCart(context, baseURL!);
    await page.goto("/orders/IFO-2611-ZZZZ");
    await expect(page.getByTestId("order-not-found")).toBeVisible();
    await page.goto("/orders/IFO-2611-ZZZZ?t=nope");
    await expect(page.getByText("We couldn't find that order")).toBeVisible();
    await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);
  });
});

test.describe("tracking", () => {
  test("finds an order by reference + email, rejects a wrong email, and does not reveal which part was wrong", async ({
    page,
    context,
    baseURL,
  }) => {
    await seedCart(context, baseURL!);
    await openCheckout(page);
    const email = await fillCheckout(page);
    await page.getByRole("radio", { name: /Cash on delivery/ }).check();
    await codButton(page).click();
    await expect(page).toHaveURL(/\/orders\/IFO-/);
    const ref = (await page.getByTestId("order-ref").textContent())!;

    await page.goto("/track");
    await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);
    await page.waitForLoadState("networkidle");

    await page.getByLabel("Order reference").fill(ref);
    await page.getByLabel("Email or mobile number").fill("someone.else@example.com");
    await page.getByRole("button", { name: "Track order" }).click();
    const generic = "We couldn't find that order";
    await expect(page.getByTestId("track-result")).toContainText(generic);
    const wrongEmailText = await page.getByTestId("track-result").innerText();

    await page.getByLabel("Order reference").fill("IFO-2611-ZZZZ");
    await page.getByLabel("Email or mobile number").fill(email);
    await page.getByRole("button", { name: "Track order" }).click();
    await expect(page.getByTestId("track-result")).toContainText(generic);
    expect(await page.getByTestId("track-result").innerText()).toBe(wrongEmailText);

    await page.getByLabel("Order reference").fill(ref.toLowerCase());
    await page.getByLabel("Email or mobile number").fill(email.toUpperCase());
    await page.getByRole("button", { name: "Track order" }).click();
    await expect(page.getByTestId("track-ref")).toHaveText(ref);
    await expect(page.getByTestId("track-status")).toHaveText("Confirmed");
    await expect(page.getByTestId("no-shipment")).toContainText("hasn't shipped yet");
    await expect(page.getByTestId("timeline")).toContainText("Order placed");

    // By mobile number too.
    await page.getByLabel("Email or mobile number").fill("98765 43210");
    await page.getByRole("button", { name: "Track order" }).click();
    await expect(page.getByTestId("track-ref")).toHaveText(ref);
  });

  test("shows courier, tracking number and link once a shipment exists", async ({
    page,
    context,
    baseURL,
  }) => {
    await seedCart(context, baseURL!);
    await openCheckout(page);
    const email = await fillCheckout(page);
    await page.getByRole("radio", { name: /Cash on delivery/ }).check();
    await codButton(page).click();
    await expect(page).toHaveURL(/\/orders\/IFO-/);
    const ref = (await page.getByTestId("order-ref").textContent())!;

    await sql`insert into shipments (order_id, courier, awb, tracking_url, status, shipped_at)
      select id, 'Delhivery', 'DL0012345', 'https://track.example.com/DL0012345', 'in_transit', now() from orders where ref = ${ref}`;
    await sql`update orders set fulfillment_status = 'shipped' where ref = ${ref}`;

    await page.goto("/track");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Order reference").fill(ref);
    await page.getByLabel("Email or mobile number").fill(email);
    await page.getByRole("button", { name: "Track order" }).click();
    await expect(page.getByTestId("track-status")).toHaveText("Shipped");
    await expect(page.getByTestId("shipment-courier")).toHaveText("Delhivery");
    await expect(page.getByTestId("shipment-awb")).toHaveText("DL0012345");
    await expect(page.getByRole("link", { name: /Track on Delhivery/ })).toHaveAttribute(
      "href",
      "https://track.example.com/DL0012345",
    );
  });

  test("validates the form and is rate limited per order reference", async ({ page }) => {
    await page.goto("/track");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Track order" }).click();
    await expect(page.getByText("Enter your order reference")).toBeVisible();
    await expect(page.getByLabel("Order reference")).toBeFocused();

    await page.getByLabel("Order reference").fill("IFO-2611-RATE");
    await page.getByLabel("Email or mobile number").fill("nobody@example.com");
    for (let i = 0; i < 9; i++) {
      await page.getByRole("button", { name: "Track order" }).click();
      await expect(page.getByTestId("track-result")).not.toBeEmpty();
    }
    await expect(page.getByTestId("track-result")).toContainText("Too many attempts");
  });
});

test.describe("accessibility", () => {
  for (const vibe of ["gothic", "funky"]) {
    test(`checkout has no serious or critical axe violations in ${vibe}`, async ({
      page,
      context,
      baseURL,
    }) => {
      await seedCart(context, baseURL!);
      await openCheckout(page, `/checkout?vibe=${vibe}`);
      await page.getByLabel("Pincode").fill(PINCODE_OK);
      await expect(page.getByTestId("shipping-option")).toBeVisible();
      await payButton(page).click(); // show the error state too
      await expect(page.getByTestId("error-summary")).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const bad = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
      ).toEqual([]);
    });
  }
});

/**
 * Visual review: E2E_SHOTS=<dir> writes checkout, payment dialog, confirmation and tracking screenshots
 * (phone and desktop, cute and gothic) to that directory.
 */
const SHOTS = process.env.E2E_SHOTS;
test.describe("screenshots", () => {
  test.skip(!SHOTS, "set E2E_SHOTS=<dir> to capture screenshots");

  const sizes = [
    { name: "390", width: 390, height: 844 },
    { name: "1440", width: 1440, height: 900 },
  ];
  for (const vibe of ["cute", "gothic"]) {
    for (const size of sizes) {
      test(`${vibe} ${size.name}`, async ({ page, context, baseURL }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        const shot = (name: string) =>
          page.screenshot({ path: `${SHOTS}/${vibe}-${size.name}-${name}.png`, fullPage: true });
        await seedCart(context, baseURL!);
        await openCheckout(page, `/checkout?vibe=${vibe}`);
        await shot("1-checkout-empty");
        await payButton(page).click();
        await expect(page.getByTestId("error-summary")).toBeVisible();
        await shot("2-checkout-errors");

        const email = await fillCheckout(page);
        await page.getByRole("radio", { name: /Cash on delivery/ }).check();
        await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false");
        await shot("3-checkout-cod");
        await page.getByRole("radio", { name: /Pay online/ }).check();
        await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false");
        await payButton(page).click();
        const dialog = page.getByRole("dialog", { name: "Test payment (dev mock)" });
        await expect(dialog).toBeVisible();
        await page.waitForTimeout(400);
        await shot("4-mock-dialog");
        await dialog.getByTestId("mock-failure").click();
        await expect(page.getByTestId("payment-status")).toContainText("Payment not completed");
        await shot("5-payment-not-completed");
        await page.getByTestId("payment-retry").click();
        await dialog.getByTestId("mock-success").click();
        await expect(page).toHaveURL(/\/orders\/IFO-/);
        await expect(page.getByTestId("order-status")).toHaveText("Confirmed");
        await page.waitForTimeout(400);
        await shot("6-confirmation");
        const ref = (await page.getByTestId("order-ref").textContent())!;

        await page.goto(`/track?vibe=${vibe}`);
        await page.waitForLoadState("networkidle");
        await shot("7-track-empty");
        await page.getByLabel("Order reference").fill(ref);
        await page.getByLabel("Email or mobile number").fill(email);
        await page.getByRole("button", { name: "Track order" }).click();
        await expect(page.getByTestId("track-ref")).toBeVisible();
        await shot("8-track-found");
      });
    }
  }
});
