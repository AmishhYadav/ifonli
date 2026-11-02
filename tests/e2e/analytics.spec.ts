import { readFileSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { createAdminAccount } from "./helpers/admin-account";
import { totp } from "./helpers/totp";

/**
 * Analytics e2e (plan 12, Phase 6).
 *
 * - "storefront events": runs against any seeded dev server. It records what the browser sends to
 *   `/api/events` (the beacon) while browsing home -> product page -> add to cart, without a database.
 * - "consent": the banner and the optional GA4. Needs a server started with NEXT_PUBLIC_GA4_ID (set the same
 *   value in E2E_GA4_ID); without it the test only proves that nothing is shown and nothing is loaded.
 * - "reports": needs the dev stack, like admin.spec.ts (E2E_ADMIN_FLOW=1): creates an owner, enrols TOTP,
 *   opens Reports and Insights and downloads a CSV.
 *
 *     E2E_BASE_URL=http://localhost:3104 pnpm e2e tests/e2e/analytics.spec.ts --project=chromium-desktop
 */

interface Beacon {
  event: string;
  productId?: string;
  value?: number;
  path?: string;
  vibe?: string;
  meta?: Record<string, unknown>;
}

/**
 * Collects every event the page beacons. Playwright cannot read the body of a `sendBeacon(Blob)` request,
 * so an init script wraps `navigator.sendBeacon` and keeps a copy of each body (the real call still goes out).
 */
function recordBeacons(page: Page) {
  const events: Beacon[] = [];
  const sessions = new Set<string>();
  const statuses: number[] = [];
  let pulled = 0;
  void page.addInitScript(() => {
    const w = window as unknown as { __beacons: Promise<string>[] };
    w.__beacons = [];
    const original = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      if (data instanceof Blob) w.__beacons.push(data.text());
      return original(url, data);
    };
  });
  page.on("response", (res) => {
    if (res.url().endsWith("/api/events")) statuses.push(res.status());
  });
  /** Pulls the bodies sent so far into `events` / `sessions`. */
  const pull = async () => {
    const bodies = await page
      .evaluate(async (from) => {
        const w = window as unknown as { __beacons: Promise<string>[] };
        return Promise.all(w.__beacons.slice(from));
      }, pulled)
      .catch(() => [] as string[]);
    pulled += bodies.length;
    for (const text of bodies) {
      const body = JSON.parse(text) as { sessionId: string; events: Beacon[] };
      sessions.add(body.sessionId);
      events.push(...body.events);
    }
  };
  return { events, sessions, statuses, pull };
}

/** Sends whatever the helper has queued (it also flushes on a 3 s timer and when the tab is hidden). */
const flushBeacons = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("pagehide")));

type Recorder = ReturnType<typeof recordBeacons>;
/** `expect.poll` that first pulls the newest beacon bodies out of the page. */
const seen = <T,>(rec: Recorder, read: () => T) => async () => {
  await rec.pull();
  return read();
};

const settle = (page: Page) => page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

test.describe("storefront events", () => {
  test("browse home, open a product, scroll, add to cart", async ({ page, browserName, baseURL }) => {
    test.skip(
      browserName === "webkit" && !baseURL?.startsWith("https:"),
      "WebKit drops the Secure cart cookie over http",
    );
    const rec = recordBeacons(page);
    const gtm: string[] = [];
    page.on("request", (r) => {
      if (/googletagmanager|google-analytics/.test(r.url())) gtm.push(r.url());
    });

    await page.goto("/home?vibe=cute");
    await settle(page);

    // A card that stays on screen for a second is an impression (once), whichever card that is.
    const card = page.locator('[data-testid="product-card"]:not([data-sold-out])').first();
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1600);
    const productId = await card.getAttribute("data-product-id");
    expect(productId).toMatch(/^[0-9a-f-]{36}$/);
    await flushBeacons(page);
    await expect.poll(seen(rec, () => rec.events.filter((e) => e.event === "product_impression").length)).toBeGreaterThan(0);
    expect(rec.events.filter((e) => e.event === "product_impression" && e.productId === productId)).toHaveLength(1);
    expect(rec.events.find((e) => e.event === "page_view")).toMatchObject({ path: "/home", vibe: "cute" });

    // Opening the product records the click, the page view and the product view.
    await card.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/products\/[a-z0-9-]+/);
    await settle(page);
    await expect(page.getByTestId("stock-status")).toHaveAttribute("data-stock", /.+/);
    await flushBeacons(page);
    await expect.poll(seen(rec, () => rec.events.some((e) => e.event === "pdp_view" && e.productId === productId))).toBe(true);
    expect(rec.events.some((e) => e.event === "product_click" && e.productId === productId)).toBe(true);
    expect(rec.events.filter((e) => e.event === "page_view").map((e) => e.path)).toEqual(
      expect.arrayContaining(["/home", expect.stringMatching(/^\/products\//)]),
    );

    // Scrolling to the bottom reaches every depth milestone, each reported once.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await flushBeacons(page);
    await expect
      .poll(seen(rec, () => rec.events.filter((e) => e.event === "pdp_scroll_depth").map((e) => e.value)))
      .toEqual([25, 50, 75, 100]);

    // Add to cart (the stock hole is already loaded above).
    await page.evaluate(() => window.scrollTo(0, 0));
    const add = page.getByTestId("add-to-cart");
    if (await add.isEnabled()) {
      await add.click();
      await expect(page.getByRole("button", { name: "View bag" })).toBeVisible();
      await flushBeacons(page);
      await expect
        .poll(seen(rec, () => rec.events.some((e) => e.event === "add_to_cart" && e.productId === productId && e.value === 1)))
        .toBe(true);
    }

    // Wishlist heart on the product page.
    await page.getByTestId("wishlist-heart").first().click();
    await flushBeacons(page);
    await expect.poll(seen(rec, () => rec.events.some((e) => e.event === "wishlist_add" && e.productId === productId))).toBe(true);

    await rec.pull();
    // Every request was accepted, with one anonymous session id and no query strings or personal data.
    expect(rec.statuses.length).toBeGreaterThan(0);
    expect(new Set(rec.statuses)).toEqual(new Set([204]));
    expect(rec.sessions.size).toBe(1);
    const [sid] = [...rec.sessions];
    expect(sid).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "ifonli_sid")?.value).toBe(sid);
    for (const e of rec.events) expect(e.path ?? "/").not.toMatch(/[?#]/);
    expect(gtm).toEqual([]); // no third-party analytics without consent
  });

  test("an unconsented visit never loads Google Analytics and the cart page reports view_cart", async ({ page }) => {
    const rec = recordBeacons(page);
    await page.goto("/cart");
    await settle(page);
    await flushBeacons(page);
    await expect.poll(seen(rec, () => rec.events.some((e) => e.event === "view_cart"))).toBe(true);
    await expect(page.locator("script[src*='googletagmanager']")).toHaveCount(0);
  });

  test("a search with no results is reported with its term and a zero count", async ({ page }) => {
    const rec = recordBeacons(page);
    await page.goto("/search?q=zzzxqv-nothing");
    await settle(page);
    await flushBeacons(page);
    await expect
      .poll(seen(rec, () => rec.events.find((e) => e.event === "search")))
      .toMatchObject({ value: 0, meta: { q: "zzzxqv-nothing" } });
  });
});

test.describe("consent and optional GA4", () => {
  const ga4Id = process.env.E2E_GA4_ID;

  test("without a GA4 id there is no banner and no cookie settings link", async ({ page }) => {
    test.skip(Boolean(ga4Id), "this server has GA4 configured");
    await page.goto("/home");
    await settle(page);
    await expect(page.getByTestId("consent-banner")).toHaveCount(0);
    await expect(page.getByTestId("cookie-settings")).toHaveCount(0);
  });

  test("with a GA4 id: banner first, nothing loads until allowed, choice is remembered and changeable", async ({
    page,
    context,
    isMobile,
  }) => {
    test.skip(!ga4Id, "set E2E_GA4_ID to the NEXT_PUBLIC_GA4_ID the server was started with");
    // The Next dev-tools badge floats over the bottom-left corner on phones (dev server only), so
    // phone runs dispatch the click instead of using pointer coordinates.
    const press = (l: Locator) => (isMobile ? l.dispatchEvent("click") : l.click());
    const gaRequests: string[] = [];
    await context.route(/googletagmanager\.com|google-analytics\.com/, (route) => {
      gaRequests.push(route.request().url());
      return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
    });

    await page.goto("/home");
    await settle(page);
    const banner = page.getByTestId("consent-banner");
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("button", { name: "Allow Google Analytics" })).toBeVisible();
    await expect(banner.getByRole("button", { name: "No thanks" })).toBeVisible();
    await expect(banner.getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", "/policies/privacy");
    expect(gaRequests).toEqual([]);

    // Decline: banner goes, still nothing loaded, choice survives a reload.
    await press(banner.getByRole("button", { name: "No thanks" }));
    await expect(banner).toHaveCount(0);
    expect((await context.cookies()).find((c) => c.name === "ifonli_consent")?.value).toBe("denied");
    await page.reload();
    await settle(page);
    await expect(page.getByTestId("consent-banner")).toHaveCount(0);
    expect(gaRequests).toEqual([]);

    // Change of mind from the footer.
    await press(page.getByTestId("cookie-settings"));
    await expect(page.getByTestId("consent-banner")).toBeVisible();
    await press(page.getByRole("button", { name: "Allow Google Analytics" }));
    await expect(page.getByTestId("consent-banner")).toHaveCount(0);
    expect((await context.cookies()).find((c) => c.name === "ifonli_consent")?.value).toBe("granted");
    await expect.poll(() => gaRequests.some((u) => u.includes(`id=${ga4Id}`))).toBe(true);
  });
});

/** Waits for hydration: text typed into a controlled input before React attaches is thrown away. */
async function gotoLogin(page: Page) {
  await page.goto("/admin/login");
  await page.waitForLoadState("networkidle");
}

test.describe("reports", () => {
  test.skip(!process.env.E2E_ADMIN_FLOW, "set E2E_ADMIN_FLOW=1 (needs the dev database)");
  test.describe.configure({ mode: "serial" });

  const stamp = Date.now();
  const email = `e2e-reports-${stamp}@ifonli.local`;
  const password = `E2e-Reports-${stamp}!`;
  let secret = "";

  test.beforeAll(() => {
    createAdminAccount(email, password, "owner");
  });

  test("enrol two-factor, open Reports, export a CSV, open Insights", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop only");
    await gotoLogin(page);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Set up two-factor sign-in" })).toBeVisible();
    await page.getByLabel("Confirm your password").fill(password);
    await page.getByRole("button", { name: "Show QR code" }).click();
    await page.getByText("Can't scan?").click();
    secret = (await page.locator("details code").innerText()).trim();
    await page.getByLabel("6-digit code").fill(totp(secret));
    await page.getByRole("button", { name: "Verify and turn on" }).click();
    await page.getByRole("button", { name: /I have saved them/ }).click();
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();

    // Reports is in the sidebar and no longer a placeholder.
    await page.getByRole("link", { name: "Reports", exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/reports/);
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
    await expect(page.getByText("Coming soon")).toHaveCount(0);
    for (const name of ["Sales", "Shopping funnel", "Orders by status", "Coupon performance", "Top products", "Top vibes", "Top product types"]) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }
    await expect(page.getByRole("img", { name: /Revenue by day/ })).toBeVisible();

    // A narrower range goes into the URL and the CSV.
    await page.getByLabel("From", { exact: true }).fill("2026-10-01");
    await page.getByLabel("To", { exact: true }).fill("2026-10-07");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/from=2026-10-01&to=2026-10-07/);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: /Export CSV of Sales/ }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("ifonli-sales-2026-10-01_to_2026-10-07.csv");
    const csv = readFileSync((await download.path())!, "utf8");
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("Day,Orders,Revenue (INR),Discounts (INR),Average order value (INR)");
    expect(lines).toHaveLength(1 + 7); // one row per day in the range

    const [funnel] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: /Export CSV of Shopping funnel/ }).click(),
    ]);
    expect(readFileSync((await funnel.path())!, "utf8").split("\r\n")[0]).toBe(
      "Stage,Sessions,Of all sessions (%),Of previous stage (%),Dropped since previous",
    );

    // Insights
    await page.getByRole("link", { name: "Insights", exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/insights/);
    await expect(page.getByRole("heading", { name: "Insights", level: 1 })).toBeVisible();
    for (const name of ["Worth a look", "Most viewed", "Most seen in listings", "Scroll engagement", "Vibe performance", "Hero tile clicks", "Searches with no results"]) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }
    await page.getByLabel("Vibe", { exact: true }).selectOption("gothic");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/vibe=gothic/);
    // Changing the vibe again replaces it (it is not carried along twice).
    await page.getByLabel("Vibe", { exact: true }).selectOption("cute");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/vibe=cute/);
    expect(new URL(page.url()).searchParams.getAll("vibe")).toEqual(["cute"]);

    // The export endpoint is admin-only.
    const anon = await page.context().browser()!.newContext();
    const res = await anon.request.get(`${page.url().split("/admin")[0]}/admin/reports/export?report=sales`, { maxRedirects: 0 });
    expect([302, 307, 401, 403]).toContain(res.status());
    await anon.close();
  });
});
