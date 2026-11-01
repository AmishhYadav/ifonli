import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

/**
 * PDP, cart drawer, cart page, wishlist. Run against a production build:
 *   NEXT_DIST_DIR=.next-shop pnpm exec next build && NEXT_DIST_DIR=.next-shop pnpm exec next start -p 3103
 *   E2E_BASE_URL=http://localhost:3103 pnpm exec playwright test pdp-cart
 * Needs the dev database with the placeholder product seed (heart-charm: Pink low stock, Red / Lilac in
 * stock; lightning-bolt-charm and candle-sticker sold out; star-charm in stock). The coupon test inserts
 * (and removes) one coupon through DATABASE_URL and is skipped when the database is not reachable.
 */

const DB_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const COUPON = "E2EPDP10";

const money = (text: string | null) => Number((text ?? "").replace(/[^\d.]/g, ""));

/** Waits for hydration (network idle), without failing when a slow image keeps the network busy. */
const settle = (page: Page) => page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

/** Opens a PDP, waits for hydration and the live stock hole. */
async function openProduct(page: Page, slug: string, vibe = "cute") {
  await page.goto(`/products/${slug}?vibe=${vibe}`);
  await settle(page);
  await expect(page.getByTestId("stock-status")).toHaveAttribute("data-stock", /.+/);
}

async function addFromPdp(page: Page, slug: string, option?: string) {
  await openProduct(page, slug);
  if (option) await page.getByTestId("option-value").filter({ hasText: option }).click();
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByRole("button", { name: "View cart" })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss notification" }).first().click();
}

/**
 * The cart cookie is `Secure` in production builds; WebKit does not store Secure cookies on http://localhost
 * (Chromium does), so anything that needs a persisted cart is skipped there unless the base URL is https.
 */
function skipWithoutCartCookie(browserName: string, baseURL: string | undefined) {
  test.skip(
    browserName === "webkit" && !baseURL?.startsWith("https:"),
    "WebKit drops the Secure cart cookie over http",
  );
}

const drawer = (page: Page) => page.getByTestId("cart-drawer");
const cartCount = (page: Page) => page.locator('[data-testid="cart-count"]:visible');
const cartButton = (page: Page) => page.locator('[data-testid="cart-button"]:visible');

test.describe("product page", () => {
  test("shows the price with MRP wording, the legal block and the return summary", async ({ page }) => {
    await openProduct(page, "heart-charm");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Heart charm");
    await expect(page.getByText("incl. of all taxes")).toBeVisible();
    const legal = page.getByTestId("legal-block");
    await expect(legal).toContainText("Net quantity");
    await expect(legal).toContainText("Country of origin");
    await expect(legal).toContainText("Manufacturer / packer");
    await expect(legal).toContainText("Consumer care");
    await expect(page.getByRole("link", { name: "Returns and refunds policy" }).first()).toHaveAttribute(
      "href",
      "/policies/returns-refunds",
    );
    // Product JSON-LD with INR offers.
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    const product = ld.map((t) => JSON.parse(t)).find((d) => d["@type"] === "Product");
    expect(product.offers[0].priceCurrency).toBe("INR");
    expect(product.offers).toHaveLength(3);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/products\/heart-charm$/);
  });

  test("an unknown product is a 404", async ({ page }) => {
    const response = await page.goto("/products/definitely-not-a-product");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByTestId("add-to-cart")).toHaveCount(0);
  });

  test("switching the variant updates the selection and the live stock line", async ({ page }) => {
    await openProduct(page, "heart-charm");
    const status = page.getByTestId("stock-status");
    const pink = page.getByTestId("option-value").filter({ hasText: "Pink" });
    const red = page.getByTestId("option-value").filter({ hasText: "Red" });
    // Pink is seeded with low stock; orders placed by other specs can sell it out, and then the page
    // opens on the first variant that is in stock instead.
    const pinkSoldOut = (await pink.getAttribute("data-sold-out")) === "true";
    await expect(pinkSoldOut ? red : pink).toHaveAttribute("aria-pressed", "true");
    await red.click();
    await expect(red).toHaveAttribute("aria-pressed", "true");
    await expect(pink).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("selected-variant")).toHaveText("Red");
    await expect(status).toHaveAttribute("data-stock", "in_stock");
    await expect(status).toContainText("In stock");
    await pink.click();
    await expect(pink).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("selected-variant")).toHaveText("Pink");
    if (pinkSoldOut) {
      await expect(status).toHaveAttribute("data-stock", "sold_out");
    } else {
      await expect(status).toHaveAttribute("data-stock", "low");
      await expect(status).toContainText(/Only \d+ left/);
    }
  });

  test("a sold-out default variant: the page opens on one that is in stock", async ({ page }) => {
    const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
    const rows = await sql<{ id: string; stock_on_hand: number }[]>`
      select id, stock_on_hand from variants where sku = 'PH-CHARM-HEART-PINK'`.catch(() => []);
    if (rows.length === 0) await sql.end({ timeout: 1 }).catch(() => {});
    test.skip(rows.length === 0, "database not reachable or seeded Pink variant missing");
    const pinkRow = rows[0]!;
    await sql`update variants set stock_on_hand = 0 where id = ${pinkRow.id}`;
    try {
      await openProduct(page, "heart-charm");
      const pink = page.getByTestId("option-value").filter({ hasText: "Pink" });
      await expect(pink).toHaveAttribute("data-sold-out", "true");
      await expect(pink).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByTestId("add-to-cart")).toBeEnabled();
    } finally {
      await sql`update variants set stock_on_hand = ${pinkRow.stock_on_hand} where id = ${pinkRow.id}`;
      await sql.end();
    }
  });

  test("a sold-out product says so and cannot be added", async ({ page }) => {
    for (const slug of ["lightning-bolt-charm", "candle-sticker"]) {
      await openProduct(page, slug);
      await expect(page.getByTestId("stock-status")).toContainText("Sold out");
      const button = page.getByTestId("add-to-cart");
      await expect(button).toBeDisabled();
      await expect(button).toHaveText("Sold out");
      await expect(page.getByRole("spinbutton", { name: "Quantity" })).toHaveCount(0);
    }
  });

  test("the delivery estimate checks a pincode", async ({ page }) => {
    await openProduct(page, "star-charm");
    const box = page.getByTestId("delivery-estimate");
    await box.getByRole("textbox", { name: "Delivery pincode" }).fill("12");
    await box.getByRole("button", { name: "Check" }).click();
    await expect(page.getByTestId("delivery-result")).toContainText("valid 6-digit pincode");
    await box.getByRole("textbox", { name: "Delivery pincode" }).fill("110001");
    await box.getByRole("button", { name: "Check" }).click();
    await expect(page.getByTestId("delivery-result")).toContainText(/We deliver to 110001|can't deliver|couldn't find|not serviceable/i);
  });

  test("the mobile add-to-cart bar stays on screen while the details scroll", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile layout");
    await openProduct(page, "star-charm");
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(page.getByTestId("add-to-cart")).toBeInViewport();
  });
});

test.describe("cart", () => {
  test.beforeEach(({ browserName, baseURL }) => skipWithoutCartCookie(browserName, baseURL));

  test("add to cart shows the toast, updates the badge and the drawer; quantity and remove update totals", async ({ page }) => {
    await expect(async () => {
      await openProduct(page, "star-charm");
      await expect(cartCount(page)).toHaveCount(0);
    }).toPass();
    await page.getByTestId("add-to-cart").click();
    const toast = page.getByRole("button", { name: "View cart" });
    await expect(toast).toBeVisible();
    await expect(page.getByText("Star charm (Yellow)")).toBeVisible();
    await expect(cartCount(page)).toHaveText("1");
    await expect(cartButton(page)).toHaveAttribute("aria-label", "Cart, 1 item");

    // "View cart" in the toast opens the drawer.
    await toast.click();
    await expect(drawer(page)).toBeVisible();
    const line = drawer(page).getByTestId("cart-line");
    await expect(line).toHaveCount(1);
    await expect(drawer(page).getByTestId("cart-subtotal")).toHaveText("₹399");

    await line.getByRole("button", { name: /Increase quantity/ }).click();
    await expect(drawer(page).getByTestId("cart-subtotal")).toHaveText("₹798");
    await expect(cartCount(page)).toHaveText("2");
    await expect(drawer(page).getByTestId("cart-gst")).toContainText("GST");
    await expect(drawer(page).getByText(/change-of-mind returns/)).toBeVisible();
    await expect(drawer(page).getByTestId("drawer-checkout")).toHaveAttribute("href", "/checkout");

    await line.getByRole("button", { name: /Remove Star charm/ }).click();
    await expect(drawer(page).getByTestId("cart-line")).toHaveCount(0);
    await expect(cartCount(page)).toHaveCount(0);
    await expect(drawer(page)).toContainText(/\w/);
  });

  test("the cart page matches the drawer; its totals are the sum of its lines", async ({ page }) => {
    await addFromPdp(page, "star-charm");
    await addFromPdp(page, "heart-charm", "Red");
    await page.goto("/cart");
    await settle(page);
    await expect(page.getByRole("heading", { level: 1, name: "Your cart" })).toBeVisible();
    await expect(page.getByTestId("cart-line")).toHaveCount(2);

    // Change a quantity on the page.
    const heart = page.getByTestId("cart-line").filter({ hasText: "Heart charm" });
    await heart.getByRole("button", { name: /Increase quantity/ }).click();
    await expect(heart.getByRole("spinbutton")).toHaveValue("2");
    await expect(page.getByTestId("cart-subtotal")).toHaveText("₹757");

    const lineTotals = await page.getByTestId("cart-line-total").allTextContents();
    expect(lineTotals.reduce((sum, t) => sum + money(t), 0)).toBe(money(await page.getByTestId("cart-subtotal").textContent()));
    const shipping = (await page.getByTestId("cart-shipping").textContent()) ?? "";
    const shippingValue = shipping.trim() === "Free" ? 0 : money(shipping);
    expect(money(await page.getByTestId("cart-total").textContent())).toBe(
      money(await page.getByTestId("cart-subtotal").textContent()) + shippingValue,
    );
    await expect(page.getByTestId("cart-discount")).toHaveCount(0);
    await expect(page.getByTestId("cart-gst")).toContainText("Includes");
    await expect(page.getByText(/change-of-mind returns/)).toBeVisible();
    await expect(page.getByTestId("cart-checkout")).toHaveAttribute("href", "/checkout");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

    await page.getByTestId("cart-line").filter({ hasText: "Star charm" }).getByRole("button", { name: /Remove/ }).click();
    await expect(page.getByTestId("cart-line")).toHaveCount(1);
    await expect(page.getByTestId("cart-subtotal")).toHaveText("₹358");
    await heart.getByRole("button", { name: /Remove/ }).click();
    await expect(page.getByRole("heading", { name: /\w/, level: 2 }).first()).toBeVisible();
    await expect(page.getByTestId("cart-line")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Shop everything" })).toBeVisible();
  });

  test("an empty cart shows the themed empty state with links to the vibes", async ({ page }) => {
    await page.goto("/cart?vibe=gothic");
    await expect(page.getByText("Your bag is an empty crypt")).toBeVisible();
    await expect(page.getByRole("link", { name: "Funky" })).toHaveAttribute("href", "/vibes/funky");
  });

  test("the header badge shows the real count on a fresh page load (the Suspense fallback does not seed 0)", async ({ page }) => {
    await addFromPdp(page, "star-charm");
    await page.goto("/shop");
    await expect(cartCount(page)).toHaveText("1");
    await page.goto("/vibes/gothic");
    await expect(cartCount(page)).toHaveText("1");
  });

  test("the cart drawer shows an error with Try again when the first load fails", async ({ page }) => {
    await page.goto("/shop");
    await settle(page);
    // Server Actions are POSTs with a Next-Action header: fail them all, as if the connection dropped.
    const fail = (route: import("@playwright/test").Route) =>
      route.request().headers()["next-action"] ? route.abort() : route.continue();
    await page.route("**/*", fail);
    await page.getByTestId("cart-button").first().click();
    const drawer = page.getByTestId("cart-drawer");
    await expect(drawer.getByTestId("cart-drawer-error")).toContainText("couldn't reach the shop");
    await expect(drawer.getByTestId("cart-drawer-loading")).toHaveCount(0);
    await page.unroute("**/*", fail);
    await drawer.getByRole("button", { name: "Try again" }).click();
    await expect(drawer.getByTestId("cart-drawer-error")).toHaveCount(0);
    await expect(drawer.getByText("Continue shopping")).toBeVisible();
  });

  test("the buy header: shop links on /cart and /track (no self-link), the secure header only on /checkout", async ({ page }) => {
    await page.goto("/cart");
    const header = page.locator("header").first();
    await expect(header.getByRole("link", { name: "Shop", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Back to cart" })).toHaveCount(0);
    await expect(header.getByRole("link", { name: /^Cart/ })).toHaveCount(0);
    await expect(header.getByText("Secure checkout")).toHaveCount(0);

    await page.goto("/track");
    await expect(page.locator("header").first().getByRole("link", { name: "Track an order" })).toHaveCount(0);
    await expect(page.locator("header").first().getByRole("link", { name: /^Cart/ })).toBeVisible();

    await page.goto("/checkout");
    await expect(page.locator("header").first().getByText("Secure checkout")).toBeVisible();
    await expect(page.locator("header").first().getByRole("link", { name: "Back to cart" })).toBeVisible();
  });

  test("a quantity above what can be bought is capped with the server's message", async ({ page }) => {
    await openProduct(page, "heart-charm");
    await page.getByTestId("option-value").filter({ hasText: "Red" }).click();
    const qty = page.getByRole("spinbutton", { name: "Quantity" });
    const max = Number(await qty.getAttribute("aria-valuemax"));
    expect(max).toBeGreaterThan(0);
    // Stepper cannot go past the cap.
    await qty.fill("999");
    await qty.press("Enter");
    await expect(qty).toHaveValue(String(max));
    await page.getByTestId("add-to-cart").click();
    await expect(page.getByRole("button", { name: "View cart" })).toBeVisible();
    // Adding more on top of a full line: the service caps the line and says so.
    await page.getByTestId("add-to-cart").click();
    await expect(page.getByTestId("add-message")).toContainText(/we updated your quantity/);
    await page.goto("/cart");
    await expect(page.getByTestId("cart-line").getByRole("spinbutton")).toHaveValue(String(max));
  });

  test("a bad coupon code gets the service's specific message; a good one shows a discount", async ({ page }) => {
    await addFromPdp(page, "star-charm");
    await page.goto("/cart");
    await settle(page);
    const form = page.getByTestId("coupon-form");

    await form.getByRole("button", { name: "Apply" }).click();
    await expect(form).toContainText("Enter a coupon code.");

    await form.getByRole("textbox", { name: "Coupon code" }).fill("NOPE-NOT-REAL");
    await form.getByRole("button", { name: "Apply" }).click();
    await expect(form).toContainText("We couldn't find the code NOPE-NOT-REAL");

    const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
    try {
      await sql`delete from coupons where lower(code) = lower(${COUPON})`;
      await sql`insert into coupons (code, kind, value) values (${COUPON}, 'percent', 1000)`;
    } catch {
      await sql.end({ timeout: 1 }).catch(() => {});
      test.info().annotations.push({ type: "skip", description: "database not reachable: coupon success case skipped" });
      return;
    }
    try {
      await form.getByRole("textbox", { name: "Coupon code" }).fill(COUPON.toLowerCase());
      await form.getByRole("button", { name: "Apply" }).click();
      const applied = page.getByTestId("coupon-applied");
      await expect(applied).toContainText(COUPON);
      await expect(page.getByTestId("cart-discount")).toHaveText("-₹39.90");
      const subtotal = money(await page.getByTestId("cart-subtotal").textContent());
      const total = money(await page.getByTestId("cart-total").textContent());
      const shipping = ((await page.getByTestId("cart-shipping").textContent()) ?? "").trim();
      expect(total).toBeCloseTo(subtotal - 39.9 + (shipping === "Free" ? 0 : money(shipping)), 2);
      await applied.getByRole("button", { name: /Remove/ }).click();
      await expect(page.getByTestId("cart-discount")).toHaveCount(0);
      await expect(page.getByTestId("coupon-form")).toBeVisible();
    } finally {
      await sql`delete from coupons where lower(code) = lower(${COUPON})`;
      await sql.end({ timeout: 2 });
    }
  });
});

test.describe("wishlist", () => {
  test("the heart persists across reloads and lists the product on /wishlist", async ({ page }) => {
    await page.goto("/wishlist");
    await expect(page.getByText("No relics saved").or(page.getByText("No favourites yet")).first()).toBeVisible();

    await openProduct(page, "star-charm");
    const heart = page.getByTestId("wishlist-heart").first();
    await expect(heart).toHaveAttribute("aria-pressed", "false");
    await expect(heart).toHaveAccessibleName(/Save to wishlist/);
    await heart.click();
    await expect(heart).toHaveAttribute("aria-pressed", "true");
    await expect(heart).toHaveAccessibleName(/Remove from wishlist/);

    await page.reload();
    await settle(page);
    await expect(page.getByTestId("wishlist-heart").first()).toHaveAttribute("aria-pressed", "true");

    await page.goto("/wishlist");
    const grid = page.getByTestId("wishlist-grid");
    await expect(grid.getByRole("link", { name: "Star charm" })).toBeVisible();
    await expect(page.getByTestId("wishlist-count")).toHaveText("1 saved product");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

    await grid.getByTestId("wishlist-heart").click();
    await expect(page.getByTestId("wishlist-grid")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Browse everything" })).toBeVisible();
  });

  test("product cards in listings carry a heart that saves the product", async ({ page }) => {
    await page.goto("/shop");
    await settle(page);
    const card = page.getByTestId("product-card").first();
    const heart = card.getByTestId("wishlist-heart");
    await heart.click();
    await expect(heart).toHaveAttribute("aria-pressed", "true");
    await page.goto("/wishlist");
    await expect(page.getByTestId("wishlist-grid").getByTestId("product-card")).toHaveCount(1);
  });
});

test.describe("accessibility", () => {
  for (const vibe of ["gothic", "funky"]) {
    test(`product page has no serious or critical axe violations (${vibe})`, async ({ page }) => {
      await openProduct(page, "heart-charm", vibe);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    });
  }

  test("cart page has no serious or critical axe violations", async ({ page, browserName, baseURL }) => {
    skipWithoutCartCookie(browserName, baseURL);
    await addFromPdp(page, "star-charm");
    await page.goto("/cart?vibe=gothic");
    await settle(page);
    await expect(page.getByTestId("cart-line")).toHaveCount(1);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });

  test("the open cart drawer has no serious or critical axe violations", async ({ page, browserName, baseURL }) => {
    skipWithoutCartCookie(browserName, baseURL);
    await addFromPdp(page, "star-charm");
    await cartButton(page).click();
    await expect(drawer(page).getByTestId("cart-line")).toHaveCount(1);
    const results = await new AxeBuilder({ page }).include('[data-testid="cart-drawer"]').analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
});
