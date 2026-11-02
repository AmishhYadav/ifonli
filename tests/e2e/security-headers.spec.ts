import { randomBytes } from "node:crypto";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { createAdminAccount } from "./helpers/admin-account";
import { totp } from "./helpers/totp";

/**
 * Security headers and Content-Security-Policy (plan 13, Phase 8).
 *
 * - "headers": every route family answers with the hardening headers and a CSP (enforced or
 *   Report-Only depending on the build's CSP_MODE; both are accepted, the checks are about content).
 * - "endpoints": /api/health, /api/csp-report and /api/monitoring behave (shape, caps, rate limit).
 * - "no violations": real browser, collects `securitypolicyviolation` events and CSP console messages
 *   on the storefront, PDP, cart, checkout, guest tracking, help, admin login (and, with
 *   E2E_ADMIN_FLOW=1, signed-in admin pages). Violations fire in Report-Only mode too, so this
 *   catches a policy that would break the site BEFORE CSP_MODE=enforce is switched on.
 * - "allow-list": Razorpay Checkout.js / frames / API are allowed and an unknown origin is not. The
 *   Razorpay hosts are stubbed with `page.route`, so no network is needed.
 * - E2E_MOCK_CHECKOUT=1 (against `next dev` only, the mock does not exist in production builds) also
 *   drives checkout up to the dev mock payment dialog.
 *
 *   pnpm build && pnpm start -p 3107
 *   E2E_BASE_URL=http://localhost:3107 pnpm e2e tests/e2e/security-headers.spec.ts --project=chromium-desktop
 */

const PRODUCT = "heart-charm";

/** Collects CSP violation events (reported by the page) and CSP console messages. */
async function trackViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.exposeFunction("__reportCsp", (message: string) => {
    violations.push(message);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (window as unknown as { __reportCsp?: (m: string) => void }).__reportCsp;
      report?.(
        `${event.disposition} ${event.effectiveDirective} blocked=${event.blockedURI} source=${event.sourceFile}:${event.lineNumber}`,
      );
    });
  });
  page.on("console", (message) => {
    const text = message.text();
    if (/Content[- ]Security[- ]Policy/i.test(text))
      violations.push(`console: ${text.slice(0, 240)}`);
  });
  return violations;
}

const settle = (page: Page) =>
  page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

/** A unique fake client IP so rate-limit tests never share a bucket with another run. */
const fakeIp = () =>
  `203.0.113.${1 + Math.floor(Math.random() * 250)}-${randomBytes(3).toString("hex")}`;

const ROUTES = [
  "/",
  "/home",
  "/shop",
  `/products/${PRODUCT}`,
  "/cart",
  "/checkout",
  "/track",
  "/help",
  "/admin/login",
  "/api/health",
];

test.describe("security: headers", () => {
  for (const route of ROUTES) {
    test(`${route} sends the hardening headers and a CSP`, async ({ request }) => {
      const res = await request.get(route, { maxRedirects: 0 });
      expect([200, 307, 308]).toContain(res.status());
      const h = res.headers();
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["referrer-policy"]).toBe(
        route === "/track" ? "no-referrer" : "strict-origin-when-cross-origin",
      );
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
      expect(h["x-powered-by"]).toBeUndefined();

      const permissions = h["permissions-policy"] ?? "";
      expect(permissions).toContain("camera=()");
      expect(permissions).toContain("microphone=()");
      expect(permissions).toContain("geolocation=()");
      expect(permissions).toContain("payment=(self");

      // Framing and plugins are always blocked; the full policy is enforced or report-only.
      const enforced = h["content-security-policy"] ?? "";
      const reportOnly = h["content-security-policy-report-only"] ?? "";
      expect(enforced).toContain("frame-ancestors 'none'");
      expect(enforced).toContain("object-src 'none'");
      const full = enforced.includes("script-src") ? enforced : reportOnly;
      expect(full).toContain("default-src 'self'");
      expect(full).toContain("https://checkout.razorpay.com");
      expect(full).toContain("https://api.razorpay.com");
      // A GA4 id saved in admin settings (no NEXT_PUBLIC_GA4_ID at build) must still be able to load.
      expect(full).toContain("https://www.googletagmanager.com");
      expect(full).toContain("https://www.google-analytics.com");
      expect(full).toContain("report-uri /api/csp-report");
      expect(h["reporting-endpoints"]).toContain("/api/csp-report");
    });
  }

  test("production builds send HSTS and no eval", async ({ request, baseURL }) => {
    const res = await request.get("/");
    const h = res.headers();
    const policy = h["content-security-policy"]?.includes("script-src")
      ? h["content-security-policy"]
      : h["content-security-policy-report-only"];
    const isDevServer = policy?.includes("'unsafe-eval'") ?? false;
    test.skip(isDevServer, `${baseURL} is a dev server (eval and no HSTS are expected there)`);
    expect(h["strict-transport-security"]).toMatch(/max-age=\d{7,}/);
    expect(policy).not.toContain("'unsafe-eval'");
  });

  test("order pages and guest tracking send no Referer", async ({ request }) => {
    for (const route of ["/orders/IFO-0000-TEST?t=abc", "/track"]) {
      const res = await request.get(route);
      expect(res.headers()["referrer-policy"], route).toBe("no-referrer");
    }
  });
});

test.describe("security: endpoints", () => {
  test("GET /api/health reports the database and is never cached", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", db: "ok" });
    expect(typeof body.dbMs).toBe("number");
    // No secrets or connection details.
    expect(JSON.stringify(body)).not.toMatch(/postgres|password|secret|key/i);
  });

  async function postReport(request: APIRequestContext, ip: string, body: string, type: string) {
    return request.post("/api/csp-report", {
      data: Buffer.from(body), // raw bytes: a plain string would be JSON-encoded for application/json
      headers: { "content-type": type, "x-forwarded-for": ip },
    });
  }

  test("POST /api/csp-report accepts both report formats", async ({ request }) => {
    const ip = fakeIp();
    const legacy = JSON.stringify({
      "csp-report": {
        "document-uri": "https://ifonli.test/orders/IFO-1?t=secret",
        "effective-directive": "img-src",
        "blocked-uri": "https://evil.example/x.png?token=1",
      },
    });
    expect((await postReport(request, ip, legacy, "application/csp-report")).status()).toBe(204);
    const modern = JSON.stringify([
      {
        type: "csp-violation",
        body: { effectiveDirective: "script-src-elem", blockedURL: "inline" },
      },
    ]);
    expect((await postReport(request, ip, modern, "application/reports+json")).status()).toBe(204);
  });

  test("POST /api/csp-report rejects garbage and oversized bodies", async ({ request }) => {
    const ip = fakeIp();
    expect((await postReport(request, ip, "not json", "application/json")).status()).toBe(400);
    expect((await postReport(request, ip, "x".repeat(40_000), "application/json")).status()).toBe(
      413,
    );
  });

  test("POST /api/csp-report is rate limited per IP", async ({ request }) => {
    const ip = fakeIp();
    const body = JSON.stringify({
      "csp-report": { "effective-directive": "img-src", "blocked-uri": "inline" },
    });
    const statuses: number[] = [];
    for (let i = 0; i < 64; i++) {
      statuses.push((await postReport(request, ip, body, "application/csp-report")).status());
    }
    expect(statuses.slice(0, 60).every((s) => s === 204)).toBe(true);
    expect(statuses.slice(60)).toContain(429);
  });

  test("POST /api/monitoring never errors and rejects malformed input", async ({ request }) => {
    const ip = fakeIp();
    const ok = await request.post("/api/monitoring", {
      data: { source: "client", message: "boom", url: "/shop" },
      headers: { "x-forwarded-for": ip },
    });
    expect(ok.status()).toBe(204);
    // Without SENTRY_DSN the tunnel is inert (204); with it, bad shapes are 400.
    const bad = await request.post("/api/monitoring", {
      data: { nonsense: true },
      headers: { "x-forwarded-for": ip },
    });
    expect([204, 400]).toContain(bad.status());
  });
});

test.describe("security: no violations in a real browser", () => {
  test("home page with the hero running, vibe cycling and the search sheet", async ({ page }) => {
    const violations = await trackViolations(page);
    await page.goto("/home?vibe=cute");
    await settle(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Let the hero timeline run for a while (GSAP sets inline styles all the time).
    const hero = page.locator("[data-hero]");
    if ((await hero.count()) > 0) await expect(hero.first()).toBeVisible();
    await page.waitForTimeout(2500);
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(500);

    // The hand button re-skins the whole site: inline style/attribute changes and font swaps.
    const hand = page.getByRole("button", { name: /Change vibe/ }).first();
    if (await hand.isVisible()) {
      await hand.click();
      await hand.click();
      await page.waitForTimeout(600);
    }
    expect(violations).toEqual([]);
  });

  test("product page, add to cart, cart page and checkout", async ({ page, isMobile }) => {
    test.skip(isMobile, "the desktop project covers the purchase path");
    const violations = await trackViolations(page);
    await page.goto(`/products/${PRODUCT}?vibe=bold`);
    await settle(page);
    await expect(page.getByTestId("stock-status")).toHaveAttribute("data-stock", /.+/);
    // Pick a variant that can be bought (the first one may be sold out after other runs).
    await page
      .locator('[data-testid="option-value"]:not([data-sold-out])')
      .first()
      .click()
      .catch(() => {});
    await page.getByTestId("add-to-cart").click();
    await expect(page.getByRole("button", { name: "View bag" })).toBeVisible();

    await page.goto("/cart");
    await settle(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.goto("/checkout");
    // A production build whose launch checklist still has blockers (placeholder settings, as in CI's
    // main build) shows the "not taking orders" notice instead of the form: that is what ships. CI runs
    // this test again on the review build (gate off) so the form itself is covered too.
    const review = page.getByTestId("review");
    await expect(review.or(page.getByTestId("checkout-closed"))).toBeVisible({ timeout: 30_000 });
    if (process.env.E2E_EXPECT_CHECKOUT_FORM) await expect(review).toBeVisible();
    if (await review.isVisible()) {
      await expect(review).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
    }
    expect(violations).toEqual([]);
  });

  test("collection, search, guest tracking, help, policy, wishlist and account login", async ({ page }) => {
    const violations = await trackViolations(page);
    for (const path of [
      "/shop",
      "/vibes/gothic",
      "/search?q=heart",
      "/track",
      "/help",
      "/policies/shipping",
      "/wishlist",
      "/account/login",
    ]) {
      await page.goto(path);
      await settle(page);
    }
    expect(violations).toEqual([]);
  });

  test("admin login, including a failed sign-in", async ({ page }) => {
    const violations = await trackViolations(page);
    await page.goto("/admin/login");
    await settle(page);
    await page.getByLabel("Email").fill(`nobody-${Date.now()}@example.com`);
    await page.getByLabel("Password").fill("not-the-password-123");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    expect(violations).toEqual([]);
  });

  test("the CSP lets Razorpay load and blocks everything else (stubbed network)", async ({
    page,
    request,
  }) => {
    const home = await request.get("/");
    const enforcing = (home.headers()["content-security-policy"] ?? "").includes("script-src");
    const violations = await trackViolations(page);

    await page.route("https://checkout.razorpay.com/**", (route) =>
      route.fulfill({ contentType: "text/javascript", body: "window.__rzpLoaded = true;" }),
    );
    await page.route("https://api.razorpay.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>rzp</title>" }),
    );
    await page.route("https://lumberjack.razorpay.com/**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: "{}",
        headers: { "access-control-allow-origin": "*" },
      }),
    );
    await page.route("https://evil.example/**", (route) =>
      route.fulfill({ contentType: "text/javascript", body: "window.__evilLoaded = true;" }),
    );

    await page.goto("/track");
    await settle(page);

    // The same path the app's loader takes: a <script> tag in <head>, then a frame and a beacon.
    const outcome = await page.evaluate(async () => {
      const load = (src: string) =>
        new Promise<boolean>((resolve) => {
          const el = document.createElement("script");
          el.src = src;
          el.onload = () => resolve(true);
          el.onerror = () => resolve(false);
          document.head.appendChild(el);
        });
      const rzp = await load("https://checkout.razorpay.com/v1/checkout.js");
      const frame = await new Promise<boolean>((resolve) => {
        const f = document.createElement("iframe");
        f.src = "https://api.razorpay.com/v1/checkout/public";
        f.onload = () => resolve(true);
        f.onerror = () => resolve(false);
        document.body.appendChild(f);
      });
      const beacon = await fetch("https://lumberjack.razorpay.com/v1/track", { mode: "cors" })
        .then(() => true)
        .catch(() => false);
      const evil = await load("https://evil.example/x.js");
      const w = window as unknown as { __rzpLoaded?: boolean; __evilLoaded?: boolean };
      return { rzp, frame, beacon, evil, rzpRan: !!w.__rzpLoaded, evilRan: !!w.__evilLoaded };
    });

    expect(outcome.rzp && outcome.rzpRan).toBe(true);
    expect(outcome.frame).toBe(true);
    expect(outcome.beacon).toBe(true);
    // The unknown origin is always reported; it only fails to run when the policy is enforced.
    expect(violations.some((v) => v.includes("evil.example"))).toBe(true);
    // Compare the blocked resource only: console messages repeat the whole policy (which names Razorpay).
    expect(
      violations.some(
        (v) => /blocked=\S*razorpay/.test(v) || /load .*razorpay\.com\S* because/.test(v),
      ),
    ).toBe(false);
    if (enforcing) expect(outcome.evilRan).toBe(false);
  });
});

test.describe("security: dev mock payment dialog", () => {
  test.skip(
    !process.env.E2E_MOCK_CHECKOUT,
    "set E2E_MOCK_CHECKOUT=1 and run against `next dev` (the mock is dev-only)",
  );

  test("checkout up to the mock dialog has no violations", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop only");
    const violations = await trackViolations(page);
    await page.goto(`/products/${PRODUCT}`);
    await settle(page);
    await page.getByTestId("add-to-cart").click();
    await expect(page.getByRole("button", { name: "View bag" })).toBeVisible();
    await page.goto("/checkout");
    await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false", {
      timeout: 30_000,
    });
    await page.getByLabel("Email").fill(`e2e-csp-${randomBytes(4).toString("hex")}@example.com`);
    await page.getByLabel("Mobile number").fill("98765 43210");
    await page.getByLabel("Pincode").fill("400001");
    await expect(page.getByLabel("City")).not.toHaveValue("");
    await page.getByLabel("Full name").fill("Asha Rao");
    await page.getByLabel("House or flat number and street").fill("12 Marine Drive");
    await page.getByRole("checkbox", { name: /I have read and agree/ }).check();
    await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false");
    await page.getByRole("button", { name: /^Pay .* securely$/ }).click();
    const dialog = page.getByRole("dialog", { name: "Test payment (dev mock)" });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("mock-dismiss").click();
    expect(violations).toEqual([]);
  });
});

test.describe("security: signed-in admin pages", () => {
  test.skip(!process.env.E2E_ADMIN_FLOW, "set E2E_ADMIN_FLOW=1 (needs the dev database)");

  test("every admin module has no violations", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop only");
    test.setTimeout(180_000);
    const stamp = Date.now();
    const email = `e2e-csp-admin-${stamp}@ifonli.local`;
    const password = `E2e-Csp-${stamp}!`;
    createAdminAccount(email, password, "owner");

    const violations = await trackViolations(page);
    await page.goto("/admin/login");
    await settle(page);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Set up two-factor sign-in" })).toBeVisible();
    await page.getByLabel("Confirm your password").fill(password);
    await page.getByRole("button", { name: "Show QR code" }).click();
    await expect(page.getByAltText("Authenticator QR code")).toBeVisible();
    await page.getByText("Can't scan?").click();
    const secret = (await page.locator("details code").innerText()).trim();
    await page.getByLabel("6-digit code").fill(totp(secret));
    await page.getByRole("button", { name: "Verify and turn on" }).click();
    await expect(page.getByRole("heading", { name: "Save your backup codes" })).toBeVisible();
    await page.getByRole("button", { name: /I have saved them/ }).click();
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();

    for (const path of [
      "/admin",
      "/admin/products",
      "/admin/products/new",
      "/admin/orders",
      "/admin/inventory",
      "/admin/discounts",
      "/admin/discounts/new",
      "/admin/collections",
      "/admin/customers",
      "/admin/support",
      "/admin/support?tab=cases",
      "/admin/content",
      "/admin/faq",
      "/admin/policies",
      "/admin/policies/shipping",
      "/admin/settings",
      "/admin/users",
      "/admin/audit",
      "/admin/reports",
      "/admin/insights",
    ]) {
      await page.goto(path);
      await settle(page);
      await expect(page.locator("main").first()).toBeVisible();
    }
    expect(violations).toEqual([]);
  });
});
