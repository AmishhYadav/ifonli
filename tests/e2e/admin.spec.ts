import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { createAdminAccount } from "./helpers/admin-account";
import { totp } from "./helpers/totp";

/**
 * Admin e2e.
 *
 * - "gating": runs anywhere (no database needed): /admin without a session lands on the login page.
 * - "full flow": needs the dev stack (local Supabase + migrated DB + storage buckets). It is skipped
 *   unless E2E_ADMIN_FLOW=1. It creates its own admin with `scripts/create-admin.ts` (unique email per
 *   run), enrols TOTP through the UI (the manual key is read from the page and turned into a code with
 *   `helpers/totp.ts`, exactly what an authenticator app does), signs out, signs back in with
 *   password + TOTP, creates a product and uploads images.
 *
 *     E2E_ADMIN_FLOW=1 E2E_BASE_URL=http://localhost:3102 pnpm e2e tests/e2e/admin.spec.ts --project=chromium-desktop
 */

test.describe("gating", () => {
  test("unauthenticated /admin redirects to the login page", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("deep admin links redirect too, and the login page is not indexable", async ({
    page,
    request,
  }) => {
    await page.goto("/admin/products");
    await expect(page).toHaveURL(/\/admin\/login/);
    const res = await request.get("/admin/login");
    expect(res.headers()["x-robots-tag"]).toContain("noindex");
    await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);
  });

  test("a wrong password shows a generic error", async ({ page }) => {
    await gotoLogin(page);
    await page
      .getByLabel("Email")
      .fill(`nobody-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`);
    await page.getByLabel("Password").fill("not-the-password-123");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
  });
});

/** Waits for hydration: text typed into a controlled input before React attaches is thrown away (seen on WebKit). */
async function gotoLogin(page: Page) {
  await page.goto("/admin/login");
  await page.waitForLoadState("networkidle");
}

async function signInWithTotp(page: Page, email: string, password: string, secret: string) {
  await gotoLogin(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Two-factor code" })).toBeVisible();
  await page.getByLabel("Authenticator code").fill(totp(secret));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1, exact: true })).toBeVisible();
}

test.describe("full flow", () => {
  test.skip(
    !process.env.E2E_ADMIN_FLOW,
    "set E2E_ADMIN_FLOW=1 (needs the dev database and storage)",
  );
  test.describe.configure({ mode: "serial" });

  const stamp = Date.now();
  const email = `e2e-admin-${stamp}@ifonli.local`;
  const password = `E2e-Admin-${stamp}!`;
  const productName = `E2E Test Charm ${stamp}`;
  const slug = `e2e-test-charm-${stamp}`;
  let secret = "";

  test.beforeAll(() => {
    createAdminAccount(email, password, "owner");
  });

  test("first login forces two-factor enrolment", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop only");
    await gotoLogin(page);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Set up two-factor sign-in" })).toBeVisible();

    // Admin pages are not reachable before enrolment is complete.
    await page.goto("/admin/products");
    await expect(page).toHaveURL(/\/admin\/enroll-2fa/);

    await page.getByLabel("Confirm your password").fill(password);
    await page.getByRole("button", { name: "Show QR code" }).click();
    await expect(page.getByAltText("Authenticator QR code")).toBeVisible();
    await page.getByText("Can't scan?").click();
    secret = (await page.locator("details code").innerText()).trim();
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);

    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Verify and turn on" }).click();
    await expect(page.getByText("That code is not valid")).toBeVisible();

    await page.getByLabel("6-digit code").fill(totp(secret));
    await page.getByRole("button", { name: "Verify and turn on" }).click();
    await expect(page.getByRole("heading", { name: "Save your backup codes" })).toBeVisible();
    await page.getByRole("button", { name: /I have saved them/ }).click();
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1, exact: true })).toBeVisible();
  });

  test("sign out and back in with password + authenticator code", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop only");
    await signInWithTotp(page, email, password, secret);
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
    await page.goto("/admin/products");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("create a product, validate, upload images, edit and archive", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop only");
    await signInWithTotp(page, email, password, secret);
    await page.getByRole("link", { name: "Products", exact: true }).first().click();
    await page.getByRole("link", { name: "New product" }).click();

    await page.locator("#f-name").fill(productName);
    await expect(page.locator("#f-slug")).toHaveValue(slug);
    await expect(page.getByLabel("Available")).toBeVisible(); // live slug check
    await page.getByLabel("Description (Markdown)").fill("A tiny **test** charm.");

    await page.getByRole("tab", { name: "Vibes" }).click();
    await page.getByLabel("Mochi").click();
    await page.getByLabel("Featured rank").fill("3");

    await page.getByRole("tab", { name: "Options & variants" }).click();
    await page.getByLabel("SKU for variant 1").fill(`E2E-${stamp}`);
    await page.getByLabel("Price for variant 1").fill("300");
    await page.getByLabel("MRP for variant 1").fill("249");
    await page.getByLabel("Opening stock for variant 1").fill("7");
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByText("Price cannot be above MRP", { exact: true })).toBeVisible();

    await page.getByLabel("Price for variant 1").fill("199.50");
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name: productName })).toBeVisible();

    // Next keeps the previous page mounted but hidden, so scope later lookups to what is visible.
    await page.getByRole("tab", { name: "Options & variants" }).click();
    await expect(page.locator('input[aria-label="SKU for variant 1"]:visible')).toHaveValue(
      `E2E-${stamp}`,
    );
    await expect(page.locator('input[aria-label="Price for variant 1"]:visible')).toHaveValue(
      "199.50",
    );

    // Images: a cutout without alpha is rejected, a transparent one is accepted.
    await page.getByRole("tab", { name: "Images & cutouts" }).click();
    const opaque = await sharp({
      create: { width: 1200, height: 1200, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer();
    const transparent = await sharp({
      create: {
        width: 1200,
        height: 1200,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0.4 },
      },
    })
      .png()
      .toBuffer();

    await page.getByRole("button", { name: "Add cutout" }).click();
    await page
      .locator("#img-file")
      .setInputFiles({ name: "opaque.png", mimeType: "image/png", buffer: opaque });
    await page.locator("#img-alt").fill("Opaque red square");
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByText(/no transparency/i)).toBeVisible();
    await page
      .locator("#img-file")
      .setInputFiles({ name: "cutout.png", mimeType: "image/png", buffer: transparent });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByText("Cutout added")).toBeVisible();
    await expect(page.locator('input[aria-label="Alt text"]:visible').first()).toHaveValue(
      "Opaque red square",
    );

    // Edit: rename the product (slug follows only for new products) and save.
    await page.getByRole("tab", { name: "Details" }).click();
    await page.locator("#f-name:visible").fill(`${productName} v2`);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Product saved")).toBeVisible();

    // List shows it; archive it.
    await page.goto("/admin/products");
    await page.getByRole("searchbox", { name: "Search products" }).fill(productName);
    await expect(page.getByRole("link", { name: new RegExp(`${productName} v2`) })).toBeVisible();
    await page.getByRole("link", { name: new RegExp(`${productName} v2`) }).click();
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText("Product archived")).toBeVisible();
  });
});
