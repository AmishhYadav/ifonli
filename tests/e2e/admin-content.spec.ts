import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

import { createAdminAccount } from "./helpers/admin-account";
import { totp } from "./helpers/totp";

/**
 * Admin content e2e: settings, policies (publish gating + RBAC), banners and the announcement bar on the
 * home page, FAQ on /help, staff users and the audit log.
 *
 * Needs the dev stack (migrated + seeded database, `pnpm db:seed`, `scripts/seed-content.ts`; optionally
 * `pnpm db:seed-products` for the hero / featured checks), so it is skipped unless E2E_ADMIN_FLOW=1.
 * Creates its own owner and admin (unique emails per run), enrols TOTP through the UI like an authenticator
 * app would, cleans up the banners and FAQ it creates, and resets the shipping policy and two settings
 * first (tests/e2e/helpers/reset-content.ts) so it can be re-run.
 *
 *   E2E_ADMIN_FLOW=1 E2E_BASE_URL=http://localhost:3103 pnpm e2e tests/e2e/admin-content.spec.ts --project=chromium-desktop
 */

test.describe("admin content flows", () => {
  test.skip(!process.env.E2E_ADMIN_FLOW, "set E2E_ADMIN_FLOW=1 (needs the dev database)");
  // Serial, and a longer budget: a sign-in may wait up to 30 s for a fresh authenticator step.
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  const stamp = Date.now();
  const owner = {
    email: `e2e-owner-${stamp}@ifonli.local`,
    password: `E2e-Owner-${stamp}!`,
    secret: "",
  };
  const admin = {
    email: `e2e-admin-${stamp}@ifonli.local`,
    password: `E2e-Admin-${stamp}!`,
    secret: "",
  };

  function createAccount(email: string, password: string, role: "owner" | "admin") {
    createAdminAccount(email, password, role);
  }

  /** Waits for hydration: text typed into a controlled input before React attaches is thrown away. */
  async function visit(page: Page, url: string) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
  }
  const gotoLogin = (page: Page) => visit(page, "/admin/login");

  /** First sign-in: password, then enrol the authenticator through the UI. Returns the TOTP secret. */
  async function enrol(page: Page, who: { email: string; password: string }): Promise<string> {
    await gotoLogin(page);
    await page.getByLabel("Email").fill(who.email);
    await page.getByLabel("Password").fill(who.password);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Set up two-factor sign-in" })).toBeVisible();
    await page.getByLabel("Confirm your password").fill(who.password);
    await page.getByRole("button", { name: "Show QR code" }).click();
    await page.getByText("Can't scan?").click();
    const secret = (await page.locator("details code").innerText()).trim();
    usedSteps.set(secret, Math.floor(Date.now() / 30_000));
    await page.getByLabel("6-digit code").fill(totp(secret));
    await page.getByRole("button", { name: "Verify and turn on" }).click();
    await expect(page.getByRole("heading", { name: "Save your backup codes" })).toBeVisible();
    await page.getByRole("button", { name: /I have saved them/ }).click();
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
    return secret;
  }

  const usedSteps = new Map<string, number>();
  async function signIn(page: Page, who: { email: string; password: string; secret: string }) {
    await gotoLogin(page);
    await page.getByLabel("Email").fill(who.email);
    await page.getByLabel("Password").fill(who.password);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Two-factor code" })).toBeVisible();
    // An authenticator code is single-use per 30 s step: when the previous sign-in used this step, wait for the next.
    const step = () => Math.floor(Date.now() / 30_000);
    if (usedSteps.get(who.secret) === step())
      await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
    usedSteps.set(who.secret, step());
    await page.getByLabel("Authenticator code").fill(totp(who.secret));
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
  }

  test.beforeAll(() => {
    // The spec edits shared content (the shipping policy, two settings): start from the seeded state.
    execFileSync("pnpm", ["exec", "tsx", "tests/e2e/helpers/reset-content.ts"], { stdio: "pipe" });
    execFileSync(
      "pnpm",
      ["exec", "tsx", "--conditions=react-server", "scripts/seed-content.ts", "--force"],
      {
        stdio: "pipe",
      },
    );
    createAccount(owner.email, owner.password, "owner");
    createAccount(admin.email, admin.password, "admin");
  });

  // Later specs (content.spec) expect the seeded draft shipping policy and its text: put both back.
  test.afterAll(() => {
    execFileSync("pnpm", ["exec", "tsx", "tests/e2e/helpers/reset-content.ts"], { stdio: "pipe" });
    execFileSync(
      "pnpm",
      ["exec", "tsx", "--conditions=react-server", "scripts/seed-content.ts", "--force"],
      { stdio: "pipe" },
    );
  });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, "desktop only");
  });

  test("owner: settings (text, money, validation) show on the storefront and are audited", async ({
    page,
  }) => {
    owner.secret = await enrol(page, owner);
    const hours = `Mon to Sat, 10:00 to 18:00 IST (${stamp})`;

    await visit(page, "/admin/settings");
    await expect(page.getByTestId("launch-verdict")).toHaveText("Ready to launch: No");

    await visit(page, "/admin/settings?group=store");
    const card = page.getByTestId("setting-support_hours");
    await expect(card.getByText("Placeholder", { exact: true })).toBeVisible();
    await card.getByLabel("Support hours").fill(hours);
    await card.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Support hours saved")).toBeVisible();
    await expect(card.getByText("Set", { exact: true })).toBeVisible();

    // The text value is on the Help page straight away (cache expired by the save).
    await page.goto("/help");
    await expect(page.getByText(hours).first()).toBeVisible();

    // Validation: a bad email is refused with a field message and nothing is saved.
    await visit(page, "/admin/settings?group=store");
    const email = page.getByTestId("setting-support_email");
    await email.getByLabel("Customer-care email").fill("not-an-email");
    await email.getByRole("button", { name: "Save" }).click();
    await expect(email.getByRole("alert")).toContainText(/email/i);
    // Placeholder text cannot be saved as a real value.
    await email.getByLabel("Customer-care email").fill("placeholder@example.invalid");
    // Unchanged from the placeholder, so the button offers to "confirm" it, which the server refuses.
    await email.getByRole("button", { name: "Confirm this value" }).click();
    await expect(email.getByRole("alert")).toContainText(/placeholder/i);

    // Money is typed in rupees and stored as paise.
    await visit(page, "/admin/settings?group=shipping");
    const fee = page.getByTestId("setting-flat_fee");
    await fee.getByLabel("Flat shipping fee").fill("49.50");
    await fee.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Flat shipping fee saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("setting-flat_fee").getByLabel("Flat shipping fee")).toHaveValue(
      "49.50",
    );
    // A bad amount is caught in the browser.
    const feeAgain = page.getByTestId("setting-flat_fee");
    await feeAgain.getByLabel("Flat shipping fee").fill("49.505");
    await feeAgain.getByRole("button", { name: "Save" }).click();
    await expect(feeAgain.getByRole("alert")).toContainText(/rupees/i);

    // Audit: the save is recorded with before / after.
    await visit(page, "/admin/audit?entity=setting&entityId=support_hours");
    const row = page.getByTestId("audit-row").first();
    await expect(row).toContainText("setting.update");
    await expect(row).toContainText(owner.email);
    await row.getByText(/^\d+ lines?/).click();
    await expect(row.getByTestId("audit-diff")).toContainText(hours);
    await expect(row.getByTestId("audit-diff")).toContainText('"isPlaceholder": true');
  });

  test("owner: a policy with unresolved settings cannot be published; a clean one can, and goes live", async ({
    page,
  }) => {
    await signIn(page, owner);
    await visit(page, "/admin/policies/shipping");
    await expect(page.getByRole("heading", { level: 1, name: "Shipping Policy" })).toBeVisible();

    // legal_name is a launch-required placeholder, so the token blocks publishing.
    const body = page.getByLabel("Policy text (Markdown)");
    await body.fill("# Shipping\n\nSold by {{settings.legal_name}}.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(
      page.getByText(/Draft of version 1 saved|Version 1 \(not published\)/).first(),
    ).toBeVisible();
    await expect(page.getByTestId("token-status")).toContainText(/blocks? publishing/);
    const preview = page.getByTestId("markdown-preview");
    await expect(preview).toContainText("Sold by"); // the preview follows the typing (debounced)
    await expect(preview.locator("mark[data-marker=placeholder]")).toHaveCount(1);
    await expect(page.getByTestId("publish-blocked")).toContainText(/unresolved|placeholders/);
    await expect(page.getByRole("button", { name: "Publish version 1" })).toBeDisabled();

    // Replace it with a resolved token and publish.
    await body.fill(`# Shipping\n\nWe ship ${stamp} from IfOnli ({{settings.brand_name}}).`);
    await expect(page.getByTestId("token-status")).toContainText(
      "All settings tokens are filled in",
    );
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText(/Draft of version 1 saved/)).toBeVisible();
    await expect(page.getByTestId("publish-blocked")).toHaveCount(0);
    await page.getByLabel("Effective date").fill("2026-10-01");
    await page.getByRole("button", { name: "Publish version 1" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Version 1 published")).toBeVisible();
    await expect(page.getByTestId("policy-history")).toContainText("Version 1");
    await expect(page.getByTestId("policy-history")).toContainText("Live");

    // Live on the storefront with its version and effective date; no draft banner.
    await page.goto("/policies/shipping");
    await expect(page.getByText(`We ship ${stamp} from IfOnli`)).toBeVisible();
    await expect(page.getByTestId("policy-meta")).toContainText("Version 1");
    await expect(page.getByTestId("policy-meta")).toContainText("Effective");
    await expect(page.getByTestId("draft-banner")).toHaveCount(0);

    // Editing a published policy only writes a draft: the live page does not change until publish.
    await visit(page, "/admin/policies/shipping");
    await page.getByLabel("Policy text (Markdown)").fill(`# Shipping\n\nVersion two ${stamp}.`);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft of version 2 saved")).toBeVisible();
    await page.goto("/policies/shipping");
    await expect(page.getByText(`We ship ${stamp} from IfOnli`)).toBeVisible();
    await expect(page.getByText(`Version two ${stamp}`)).toHaveCount(0);
  });

  test("admin role can edit a policy draft but not publish, and cannot open settings or users", async ({
    page,
  }) => {
    admin.secret = await enrol(page, admin);
    await visit(page, "/admin/policies/shipping");
    await expect(page.getByLabel("Policy text (Markdown)")).toBeEditable();
    await expect(page.getByText(/Save the draft and ask the owner/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Publish version/ })).toHaveCount(0);

    await visit(page, "/admin/settings");
    await expect(page).toHaveURL(/\/admin\/forbidden/);
    await visit(page, "/admin/users");
    await expect(page).toHaveURL(/\/admin\/forbidden/);
    // The audit log is readable by admins.
    await visit(page, "/admin/audit");
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  });

  test("owner: a banner and an announcement show on the home page, can be reordered, hidden and deleted", async ({
    page,
  }) => {
    await signIn(page, owner);
    const title = `E2E offer ${stamp}`;
    const note = `E2E notice ${stamp}`;

    await visit(page, "/admin/content");
    await page.getByRole("button", { name: "New banner" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Text").fill("Free gift with every order");
    await dialog.getByLabel("Link").fill("//evil.example");
    await dialog.getByRole("button", { name: "Add banner" }).click();
    await expect(dialog.getByText(/Use a path on this site/)).toBeVisible();
    await dialog.getByLabel("Link").fill("/shop");
    await dialog.getByRole("button", { name: "Add banner" }).click();
    await expect(page.getByText("Banner added")).toBeVisible();
    const row = page.getByTestId("banner-row").filter({ hasText: title });
    await expect(row).toContainText("Live");

    await page.getByRole("tab", { name: "Announcement bar" }).click();
    await page.getByRole("button", { name: "New announcement" }).click();
    await page.getByRole("dialog").getByLabel("Title").fill(note);
    await page.getByRole("dialog").getByRole("button", { name: "Add announcement" }).click();
    await expect(page.getByText("Banner added")).toBeVisible();
    await expect(page.getByTestId("banner-row").filter({ hasText: note })).toContainText(
      "Showing now",
    );

    // The home page shows both straight away.
    await page.goto("/");
    await expect(page.getByTestId("announcement-bar")).toContainText(note);
    await expect(page.getByRole("link", { name: new RegExp(title) })).toHaveAttribute(
      "href",
      "/shop",
    );
    await expect(page.getByText("Free gift with every order")).toBeVisible();

    // Hide the banner with the switch: it leaves the home page.
    await visit(page, "/admin/content?tab=offers");
    const offerRow = page.getByTestId("banner-row").filter({ hasText: title });
    await offerRow.getByRole("switch").click();
    await expect(offerRow).toContainText("Hidden");
    await page.goto("/");
    await expect(page.getByText(title)).toHaveCount(0);

    // Clean up: delete both.
    await visit(page, "/admin/content?tab=offers");
    await page.getByRole("button", { name: `Delete ${title}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("banner-row").filter({ hasText: title })).toHaveCount(0);
    await page.getByRole("tab", { name: "Announcement bar" }).click();
    await page.getByRole("button", { name: `Delete ${note}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("banner-row").filter({ hasText: note })).toHaveCount(0);
    await page.goto("/");
    await expect(page.getByTestId("announcement-bar")).toHaveCount(0);
  });

  test("owner: hero tiles and featured sets can be edited with a cutout count warning per vibe", async ({
    page,
  }) => {
    await signIn(page, owner);
    await visit(page, "/admin/content?tab=hero");
    await expect(page.getByTestId("slots-hero_tiles-cute")).toContainText("product cutouts");
    await expect(page.getByTestId("slots-hero_tiles-gothic")).toContainText("product cutouts");

    // Featured: reorder with the keyboard-accessible buttons and save.
    await visit(page, "/admin/content?tab=featured");
    const card = page.getByTestId("slots-home_featured-bold");
    const names = card.locator("ol li span.flex-1");
    const count = await names.count();
    test.skip(count < 2, "needs at least two curated featured products (pnpm db:seed-products)");
    const first = (await names.nth(0).innerText()).trim();
    await card
      .getByRole("button", {
        name: new RegExp(`Move ${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} down`),
      })
      .click();
    await card.getByRole("button", { name: "Save order" }).click();
    await expect(page.getByText(/featured on the home page saved/i)).toBeVisible();
    await page.reload();
    await expect(
      page.getByTestId("slots-home_featured-bold").locator("ol li span.flex-1").nth(1),
    ).toHaveText(first);
  });

  test("owner: FAQ question appears on /help, can be moved and unpublished", async ({ page }) => {
    await signIn(page, owner);
    const question = `E2E question ${stamp}?`;
    await visit(page, "/admin/faq");
    await page
      .getByTestId("faq-category-delivery")
      .getByRole("button", { name: "Add question" })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Question").fill(question);
    await dialog
      .getByLabel("Answer")
      .fill(
        "Orders ship in {{settings.processing_days}} days. Contact {{settings.support_email}}.",
      );
    // Placeholder tokens are flagged live in the editor.
    await expect(dialog.getByTestId("token-status")).toContainText(/blocks? publishing/);
    await dialog.getByLabel("Answer").fill("A short, **bold** answer.");
    await expect(dialog.getByTestId("markdown-preview")).toContainText("A short, bold answer.");
    await dialog.getByRole("button", { name: "Add question" }).click();
    await expect(page.getByText("Question added")).toBeVisible();
    const row = page.getByTestId("faq-row").filter({ hasText: question });
    await expect(row).toContainText("Published");

    await page.goto("/help");
    await expect(page.getByText(question)).toBeVisible();

    await visit(page, "/admin/faq");
    await page.getByRole("button", { name: `Move "${question}" up` }).click();
    await page.getByRole("switch", { name: `${question}: published` }).click();
    await expect(page.getByTestId("faq-row").filter({ hasText: question })).toContainText("Hidden");
    await page.goto("/help");
    await expect(page.getByText(question)).toHaveCount(0);

    await visit(page, "/admin/faq");
    await page.getByRole("button", { name: `Delete "${question}"` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("faq-row").filter({ hasText: question })).toHaveCount(0);
  });

  test("owner: staff users - add, guard rails on yourself, deactivate", async ({ page }) => {
    await signIn(page, owner);
    const staffEmail = `e2e-staff-${stamp}@ifonli.local`;
    await visit(page, "/admin/users");
    // No actions on your own row.
    const own = page.getByTestId("staff-row").filter({ hasText: owner.email });
    await expect(own).toContainText("(you)");
    await expect(own.getByRole("button", { name: /Actions for/ })).toHaveCount(0);

    await page.getByRole("button", { name: "Add staff member" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("E2E Packer");
    await dialog.getByLabel("Email").fill(staffEmail);
    await dialog.getByLabel("Temporary password").fill("short");
    await dialog.getByRole("button", { name: "Add staff member" }).click();
    await expect(dialog.getByText(/At least 12 characters/)).toBeVisible();
    await dialog.getByLabel("Temporary password").fill("");
    await dialog.getByRole("button", { name: "Add staff member" }).click();
    await expect(page.getByTestId("temp-password")).toHaveText(/^[A-Za-z0-9_-]{20}$/);
    await page.getByRole("button", { name: "I have saved it" }).click();

    const row = page.getByTestId("staff-row").filter({ hasText: staffEmail });
    await expect(row).toContainText("Active");
    await expect(row).toContainText("Not set up");
    await row.getByRole("button", { name: "Actions for E2E Packer" }).click();
    await page.getByRole("menuitem", { name: "Deactivate" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Deactivate" }).click();
    await expect(row).toContainText("Deactivated");
  });

  test("owner: audit log filters, shows diffs and exports CSV", async ({ page }) => {
    await signIn(page, owner);
    await visit(page, "/admin/audit");
    await expect(page.getByTestId("audit-count")).toContainText("entries");

    await page.getByLabel("Action").selectOption("policy.publish");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/action=policy\.publish/);
    const rows = page.getByTestId("audit-row");
    await expect(rows.first()).toContainText("policy.publish");
    await expect(rows.first()).toContainText(owner.email);
    // Collapsed by default; opening shows pretty JSON.
    await expect(rows.first().getByTestId("audit-diff").locator("pre")).toBeHidden();
    await rows.first().getByTestId("audit-diff").locator("summary").click();
    await expect(rows.first().getByTestId("audit-diff").locator("pre")).toContainText(
      '"effectiveDate": "2026-10-01"',
    );

    // Nothing matches a made-up person.
    await page.getByLabel("Person contains").fill("nobody-at-all");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByText("Nothing matches these filters")).toBeVisible();

    // CSV export honours the same filters.
    const csv = await page.request.get("/admin/audit/export?action=policy.publish");
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(csv.headers()["content-disposition"]).toContain("audit-log-");
    const text = await csv.text();
    expect(text.split("\r\n")[0]).toBe(
      "Time (UTC),Actor,Actor email,Action,Entity,Entity id,IP,Changes",
    );
    expect(text).toContain("policy.publish");
    expect(text).not.toContain("setting.update");
  });

  test("launch checklist lists what still blocks launch with fix links", async ({ page }) => {
    await signIn(page, owner);
    await visit(page, "/admin/settings");
    await expect(page.getByTestId("launch-verdict")).toHaveText("Ready to launch: No");
    await expect(page.getByTestId("launch-category-policies")).toContainText("not published");
    await expect(page.getByTestId("launch-category-environment")).toContainText("Razorpay");
    await page.getByText(/Show all \d+ settings that are still placeholders/).click();
    const fix = page.getByRole("link", { name: /^Fix: .*Legal entity name/ });
    await expect(fix).toHaveAttribute("href", /group=store#setting-legal_name/);
  });
});
