import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { config } from "dotenv";
import postgres from "postgres";
import { acquireFixtureLock, releaseFixtureLock } from "../support/fixture-lock";

/**
 * Customer accounts e2e: passwordless e-mail OTP login (the code is read from the dev mail channel's
 * `.dev-mail/` folder, exactly what a person reads in their inbox), profile, saved addresses, checkout
 * prefill, order history, cancel from the account, "Create an account" from a guest order, wishlist
 * sync, data export and account deletion.
 *
 * Needs the dev server (same machine, so `.dev-mail/` is shared) and the seeded dev database:
 *
 *   NEXT_DIST_DIR=.next-a pnpm exec next dev -p 3101
 *   E2E_BASE_URL=http://localhost:3101 pnpm e2e tests/e2e/account.spec.ts --project=chromium-desktop
 *
 * It writes commerce settings and pincode rows through SQL and restores them; the users
 * (e2e-account-*@example.com) and their orders are removed afterwards. Run one project at a time.
 */

config({ path: ".env.local", quiet: true });

const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL || "", { max: 2, onnotice: () => {} });

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
  cancellable_statuses: ["unfulfilled"],
};
const PINCODE = "400001";
const SKU = "PH-CHARM-HEART-LILAC";
const EMAIL_PREFIX = "e2e-account-";
const MAIL_DIR = path.join(process.cwd(), ".dev-mail");

interface Snapshot {
  settings: { key: string; value: unknown; is_placeholder: boolean }[];
  pincode: { cod_allowed: boolean; serviceable: boolean };
  variantId: string;
  stock: number;
}
let snapshot: Snapshot;

const newEmail = () => `${EMAIL_PREFIX}${randomBytes(4).toString("hex")}@example.com`;

async function deleteTestData() {
  const orderIds = sql`(select id from orders where email like ${EMAIL_PREFIX + "%"})`;
  await sql`delete from notification_outbox where order_id in ${orderIds}`;
  await sql`delete from inventory_movements where order_id in ${orderIds}`;
  await sql`delete from invoices where order_id in ${orderIds}`;
  await sql`delete from refunds where order_id in ${orderIds}`;
  await sql`delete from payments where order_id in ${orderIds}`;
  await sql`delete from orders where email like ${EMAIL_PREFIX + "%"}`;
  await sql`delete from notification_outbox where "to" like ${EMAIL_PREFIX + "%"}`;
  await sql`delete from "user" where email like ${EMAIL_PREFIX + "%"}`;
  await sql`delete from verification where identifier like ${"%" + EMAIL_PREFIX + "%"}`;
}

test.beforeAll(async () => {
  // Shared fixtures: wait for any other spec that rewrites them (tests/support/fixture-lock.ts).
  test.setTimeout(900_000);
  await acquireFixtureLock();
  const keys = Object.keys(TEST_SETTINGS);
  const settingRows = await sql<Snapshot["settings"]>`select key, value, is_placeholder from settings where key in ${sql(keys)}`;
  const [pin] = await sql<{ cod_allowed: boolean; serviceable: boolean }[]>`
    select cod_allowed, serviceable from pincodes where pincode = ${PINCODE}`;
  const [variant] = await sql<{ id: string; stock_on_hand: number }[]>`
    select id, stock_on_hand from variants where sku = ${SKU}`;
  if (!variant || !pin) throw new Error("Seed data missing: run pnpm db:seed && pnpm db:seed-products (and import the pincode reference)");
  snapshot = { settings: settingRows, pincode: pin, variantId: variant.id, stock: variant.stock_on_hand };

  for (const [key, value] of Object.entries(TEST_SETTINGS)) {
    await sql`
      insert into settings (key, value, is_placeholder) values (${key}, ${sql.json(value as never)}, false)
      on conflict (key) do update set value = excluded.value, is_placeholder = false`;
  }
  await sql`update pincodes set cod_allowed = true, serviceable = true where pincode = ${PINCODE}`;
  await sql`update variants set stock_on_hand = 200 where id = ${variant.id}`;
  await sql`delete from rate_limits where key like any(array['otp-%','pincode:%','checkout:%','cancel:%','account-%','wishlist-sync:%','support%'])`;
  await deleteTestData();
});

test.afterAll(async () => {
  try {
    await deleteTestData();
    const had = new Set(snapshot.settings.map((s) => s.key));
    for (const key of Object.keys(TEST_SETTINGS)) {
      if (!had.has(key)) await sql`delete from settings where key = ${key}`;
    }
    for (const s of snapshot.settings) {
      await sql`update settings set value = ${sql.json(s.value as never)}, is_placeholder = ${s.is_placeholder} where key = ${s.key}`;
    }
    await sql`update pincodes set cod_allowed = ${snapshot.pincode.cod_allowed}, serviceable = ${snapshot.pincode.serviceable} where pincode = ${PINCODE}`;
    await sql`update variants set stock_on_hand = ${snapshot.stock} where id = ${snapshot.variantId}`;
    await sql`delete from carts where token like 'e2e-%'`;
    await sql.end();
  } finally {
    await releaseFixtureLock();
  }
});

test.describe.configure({ mode: "serial" });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "run with --project=chromium-desktop");
});
test.setTimeout(120_000);

/** The newest sign-in code mailed to `email` (the dev channel writes `.txt` twins with the subject). */
async function readOtp(email: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    let names: string[] = [];
    try {
      names = (await readdir(MAIL_DIR)).filter((n) => n.endsWith(".txt")).sort().reverse();
    } catch {
      /* folder not created yet */
    }
    for (const name of names.slice(0, 40)) {
      const body = await readFile(path.join(MAIL_DIR, name), "utf8");
      if (!body.startsWith(`To: ${email}\n`)) continue;
      const code = body.match(/Subject: (\d{6}) is your sign-in code/)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No sign-in code mailed to ${email}`);
}

/** Waits for hydration so typed text is not thrown away by React attaching late. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
}

/** Full OTP sign-in through the UI. Returns once the post-login page is showing. */
async function signIn(page: Page, email: string, from = "/account/login") {
  await page.goto(from);
  await settle(page);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByTestId("login-info")).toContainText(email);
  const code = await readOtp(email);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function seedCart(context: BrowserContext, baseURL: string, qty = 1) {
  const token = `e2e-${randomBytes(18).toString("base64url")}`;
  const [cart] = await sql<{ id: string }[]>`insert into carts (token, expires_at) values (${token}, now() + interval '1 day') returning id`;
  await sql`insert into cart_items (cart_id, variant_id, qty) values (${cart!.id}, ${snapshot.variantId}, ${qty})`;
  await context.addCookies([{ name: "cart_token", value: token, url: baseURL }]);
}

async function openCheckout(page: Page) {
  await page.goto("/checkout");
  await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
}

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

test.describe("login", () => {
  test("signed-out visitors are sent to the login and come back to where they were going", async ({ page }) => {
    await page.goto("/account/orders");
    await expect(page).toHaveURL(/\/account\/login\?next=%2Faccount%2Forders/);
    await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
    await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);

    const email = newEmail();
    await settle(page);
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Email me a code" }).click();
    await expect(page.getByTestId("login-info")).toContainText(email);

    // A wrong code is refused with a plain message and no sign-in.
    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("That code isn't right, or it has expired")).toBeVisible();
    await expect(page).toHaveURL(/\/account\/login/);

    const code = await readOtp(email);
    await page.getByLabel("6-digit code").fill(code);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/orders(\?vibe=[a-z]+)?$/);
    await expect(page.getByRole("heading", { name: "Your orders", level: 1 })).toBeVisible();
    await expect(page.getByText("No orders yet")).toBeVisible();

    // The account was created as a customer, with its profile.
    const [row] = await sql<{ role: string; email_verified: boolean }[]>`select role, email_verified from "user" where email = ${email}`;
    expect(row).toEqual({ role: "customer", email_verified: true });

    // Sign out ends the session: the account area asks for a login again.
    await page.getByTestId("sign-out").click();
    await expect(page).toHaveURL(/\/home(\?vibe=[a-z]+)?$/);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/account\/login/);
  });

  test("a bad email is refused; an off-site next is ignored", async ({ page }) => {
    await page.goto("/account/login?next=//evil.example/steal");
    await settle(page);
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Email me a code" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");

    const email = newEmail();
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Email me a code" }).click();
    await expect(page.getByTestId("login-info")).toBeVisible();
    await page.getByLabel("6-digit code").fill(await readOtp(email));
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/account(\?vibe=[a-z]+)?$/);
    await expect(page.getByTestId("account-heading")).toBeVisible();
  });

  test("the login and account pages have no serious accessibility violations", async ({ page }) => {
    await page.goto("/account/login");
    await settle(page);
    const login = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    expect(login.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

    await signIn(page, newEmail());
    await expect(page.getByTestId("account-heading")).toBeVisible();
    for (const route of ["/account", "/account/addresses", "/account/profile", "/account/orders"]) {
      await page.goto(route);
      await settle(page);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      expect(
        results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
        route,
      ).toEqual([]);
    }
  });
});

test.describe("profile, addresses and checkout", () => {
  test("saves a profile and addresses (one default); checkout starts from the default address", async ({
    page,
    context,
    baseURL,
  }) => {
    const email = newEmail();
    await signIn(page, email);
    await expect(page).toHaveURL(/\/account(\?vibe=[a-z]+)?$/);

    // Profile
    await page.getByRole("link", { name: "Profile and privacy" }).first().click();
    await settle(page);
    await page.getByTestId("profile-name").fill("Asha Rao");
    await page.getByTestId("profile-phone").fill("98765 43210");
    await expect(page.getByTestId("profile-marketing")).not.toBeChecked();
    await page.getByTestId("profile-save").click();
    await expect(page.getByText("Your details are updated.")).toBeVisible();
    const [profile] = await sql<{ phone: string; marketing_opt_in: boolean }[]>`
      select p.phone, p.marketing_opt_in from customer_profiles p join "user" u on u.id = p.user_id where u.email = ${email}`;
    expect(profile).toEqual({ phone: "+919876543210", marketing_opt_in: false });

    // Addresses: the first is the default; adding a second as default moves the badge.
    await page.goto("/account/addresses");
    await settle(page);
    await expect(page.getByText("No saved addresses yet.")).toBeVisible();
    const addAddress = async (name: string, makeDefault: boolean) => {
      await page.getByTestId("add-address").click();
      const form = page.getByTestId("address-form");
      await form.getByLabel("Full name").fill(name);
      await form.getByLabel("Mobile number").fill("98765 43210");
      await form.getByLabel("Pincode").fill(PINCODE);
      await expect(form.getByLabel("City")).not.toHaveValue("");
      await form.getByLabel("House or flat number and street").fill(`${name}'s flat, 12 Marine Drive`);
      if (makeDefault) await form.getByLabel("Use as my default address").check();
      await page.getByTestId("address-save").click();
      await expect(page.getByTestId("address-form")).toHaveCount(0);
    };
    await addAddress("Home Address", false);
    await expect(page.getByTestId("address-card")).toHaveCount(1);
    await expect(page.getByTestId("address-default-badge")).toHaveCount(1);
    await addAddress("Work Address", true);
    await expect(page.getByTestId("address-card")).toHaveCount(2);
    await expect(page.getByTestId("address-default-badge")).toHaveCount(1);
    await expect(page.getByTestId("address-card").filter({ hasText: "Work Address" }).getByTestId("address-default-badge")).toBeVisible();
    await page.getByRole("button", { name: /Make the address for Home Address/ }).click();
    await expect(page.getByTestId("address-card").filter({ hasText: "Home Address" }).getByTestId("address-default-badge")).toBeVisible();
    await expect(page.getByTestId("address-default-badge")).toHaveCount(1);

    // Checkout is prefilled from the default address and the profile; the other address is selectable.
    await seedCart(context, baseURL!);
    await openCheckout(page);
    await expect(page.getByLabel("Email")).toHaveValue(email);
    await expect(page.getByLabel("Full name")).toHaveValue("Home Address");
    await expect(page.getByLabel("Pincode")).toHaveValue(PINCODE);
    await expect(page.getByLabel("Mobile number")).toHaveValue("+919876543210");
    const select = page.getByTestId("saved-address-select");
    const workValue = await select.locator("option", { hasText: "Work Address" }).getAttribute("value");
    await select.selectOption(workValue as string);
    await expect(page.getByLabel("Full name")).toHaveValue("Work Address");

    // Place a COD order as the signed-in customer: it is linked to the account.
    await page.getByRole("checkbox", { name: /I have read and agree/ }).check();
    await page.getByRole("radio", { name: /Cash on delivery/ }).check();
    await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false");
    await page.getByRole("button", { name: /^Place COD order/ }).click();
    await expect(page).toHaveURL(/\/orders\/IFO-[0-9A-Z-]+\?t=/);
    const ref = (await tid(page, "order-ref").textContent())!.trim();
    const [order] = await sql<{ user_id: string | null }[]>`select user_id from orders where ref = ${ref}`;
    expect(order!.user_id).not.toBeNull();
    // A signed-in customer is not offered "Create an account".
    await expect(page.getByRole("link", { name: "Create an account" })).toHaveCount(0);

    // History shows it; cancel it from the account order page.
    await page.goto("/account/orders");
    await expect(page.getByTestId("account-order-link").filter({ hasText: ref })).toBeVisible();
    await page.getByTestId("account-order-link").filter({ hasText: ref }).click();
    await expect(page).toHaveURL(new RegExp(`/account/orders/${ref}(\\?vibe=[a-z]+)?$`), { timeout: 30_000 });
    await expect(page.getByTestId("order-status")).toHaveText("Confirmed");
    await expect(page.getByTestId("download-invoice")).toHaveAttribute("href", `/api/orders/${ref}/invoice`);

    await page.getByTestId("cancel-order").click();
    const dialog = page.getByRole("dialog", { name: "Cancel this order?" });
    await expect(dialog).toContainText("You haven't paid anything yet");
    await dialog.getByTestId("cancel-keep").click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("order-status")).toHaveText("Confirmed");

    await page.getByTestId("cancel-order").click();
    await dialog.getByTestId("cancel-confirm").click();
    await expect(page.getByText("Your order is cancelled").first()).toBeVisible();
    await expect(page.getByTestId("order-status")).toHaveText("Cancelled");
    await expect(page.getByTestId("cancel-order")).toHaveCount(0);
    const [after] = await sql<{ status: string; stock: number }[]>`
      select o.status, (select stock_on_hand from variants where id = ${snapshot.variantId}) as stock
      from orders o where o.ref = ${ref}`;
    expect(after).toEqual({ status: "cancelled", stock: 200 });
  });
});

test.describe("guest order to account", () => {
  test("a guest order page offers 'Create an account'; the new account sees that order and can report a problem", async ({
    page,
    context,
    baseURL,
  }) => {
    const email = newEmail();
    await seedCart(context, baseURL!);
    await openCheckout(page);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mobile number").fill("98765 43210");
    await page.getByLabel("Pincode").fill(PINCODE);
    await expect(page.getByLabel("City")).not.toHaveValue("");
    await page.getByLabel("Full name").fill("Guest Buyer");
    await page.getByLabel("House or flat number and street").fill("5 Hill Road");
    await page.getByRole("checkbox", { name: /I have read and agree/ }).check();
    await page.getByRole("radio", { name: /Cash on delivery/ }).check();
    await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false");
    await page.getByRole("button", { name: /^Place COD order/ }).click();
    await expect(page).toHaveURL(/\/orders\/IFO-[0-9A-Z-]+\?t=/);
    const ref = (await tid(page, "order-ref").textContent())!.trim();
    const [guestOrder] = await sql<{ user_id: string | null }[]>`select user_id from orders where ref = ${ref}`;
    expect(guestOrder!.user_id).toBeNull();

    // Before shipping only "Something else" can be reported; the dialog says what it needs.
    await page.getByTestId("report-problem").click();
    const report = page.getByRole("dialog", { name: "Report a problem" });
    await expect(report.getByRole("radio")).toHaveCount(1);
    await report.getByTestId("report-next").click();
    await expect(report.getByText("Choose what went wrong")).toBeVisible();
    await report.getByRole("radio", { name: "Something else" }).check();
    await report.getByTestId("report-next").click();
    await report.getByTestId("report-next").click();
    await expect(report.getByText(/Write at least 10 characters/)).toBeVisible();
    await report.getByTestId("report-description").fill("Please can the parcel be left with the neighbour?");
    await report.getByTestId("report-next").click();
    await report.getByTestId("report-next").click();
    await expect(report.getByText(/keep the item and the packaging/)).toBeVisible();
    await report.getByTestId("report-submit").click();
    const sent = page.getByRole("dialog", { name: "We've got your report" });
    await expect(sent.getByTestId("report-done")).toContainText(email);
    await sent.getByTestId("report-close").click();
    await expect(page.getByTestId("order-reports")).toContainText("Something else");
    const [kase] = await sql<{ type: string; status: string }[]>`
      select c.type, c.status from support_cases c join orders o on o.id = c.order_id where o.ref = ${ref}`;
    expect(kase).toEqual({ type: "other", status: "open" });
    const alerts = await sql`select 1 from notification_outbox where template = 'support_case_update' and "to" = ${email}`;
    expect(alerts.length).toBe(1);

    // Create an account from the order page: the email is prefilled, and after the code the order is there.
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/account\/login\?email=/);
    await settle(page);
    await expect(page.getByTestId("login-email")).toHaveValue(email);
    await page.getByTestId("login-send").click();
    await expect(page.getByTestId("login-info")).toContainText(email);
    await page.getByTestId("login-otp").fill(await readOtp(email));
    await page.getByTestId("login-verify").click();
    await expect(page).toHaveURL(/\/account(\?vibe=[a-z]+)?$/);
    await expect(page.getByTestId("account-orders")).toContainText(ref);

    // Somebody else's order is not found, signed in or not.
    await page.goto("/account/orders/IFO-0000-NOPE");
    await expect(page.getByText("404", { exact: true })).toBeVisible();
    await expect(page.getByTestId("order-ref")).toHaveCount(0);
  });
});

test.describe("wishlist sync", () => {
  test("hearts saved as a guest move into the account on sign-in, and follow the account afterwards", async ({ page }) => {
    const email = newEmail();
    await page.goto("/shop");
    await settle(page);
    const hearts = page.getByTestId("wishlist-heart");
    await hearts.first().click();
    await expect(hearts.first()).toHaveAttribute("aria-pressed", "true");

    await signIn(page, email);
    await expect(page.getByTestId("account-heading")).toBeVisible();
    await expect
      .poll(
        async () => {
          const rows = await sql`select 1 from wishlist_items w join "user" u on u.id = w.user_id where u.email = ${email}`;
          return rows.length;
        },
        { timeout: 20_000 },
      )
      .toBe(1);

    // Un-saving on the device removes it from the account too.
    await page.goto("/shop");
    await settle(page);
    await expect(hearts.first()).toHaveAttribute("aria-pressed", "true");
    await hearts.first().click();
    await expect
      .poll(
        async () => {
          const rows = await sql`select 1 from wishlist_items w join "user" u on u.id = w.user_id where u.email = ${email}`;
          return rows.length;
        },
        { timeout: 20_000 },
      )
      .toBe(0);
  });
});

test.describe("privacy", () => {
  test("downloads my data, then deletes the account (orders are kept)", async ({ page, context, baseURL }) => {
    const email = newEmail();
    await seedCart(context, baseURL!);
    await signIn(page, email);
    await expect(page.getByTestId("account-heading")).toBeVisible();

    // Put an order on the account so there is something to keep.
    await openCheckout(page);
    await page.getByLabel("Mobile number").fill("98765 43210");
    await page.getByLabel("Pincode").fill(PINCODE);
    await expect(page.getByLabel("City")).not.toHaveValue("");
    await page.getByLabel("Full name").fill("Leaving Soon");
    await page.getByLabel("House or flat number and street").fill("9 Exit Lane");
    await page.getByRole("checkbox", { name: /I have read and agree/ }).check();
    await page.getByRole("radio", { name: /Cash on delivery/ }).check();
    await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false");
    await page.getByRole("button", { name: /^Place COD order/ }).click();
    await expect(page).toHaveURL(/\/orders\/IFO-[0-9A-Z-]+\?t=/);
    const ref = (await tid(page, "order-ref").textContent())!.trim();

    await page.goto("/account/profile");
    await settle(page);
    const exported = await page.request.get("/api/account/export");
    expect(exported.status()).toBe(200);
    expect(exported.headers()["content-disposition"]).toMatch(/attachment; filename="ifonli-my-data-\d{4}-\d{2}-\d{2}\.json"/);
    const data = await exported.json();
    expect(data.account.email).toBe(email);
    expect(data.orders.map((o: { ref: string }) => o.ref)).toEqual([ref]);
    await expect(page.getByTestId("export-data")).toHaveAttribute("href", "/api/account/export");

    await page.getByTestId("delete-account").click();
    const dialog = page.getByRole("dialog", { name: "Delete your account?" });
    await expect(dialog).toContainText("your past orders and invoices");
    await dialog.getByRole("button", { name: "Keep my account" }).click();
    await expect(dialog).toBeHidden();
    const stillThere = await sql`select 1 from "user" where email = ${email}`;
    expect(stillThere.length).toBe(1);

    await page.getByTestId("delete-account").click();
    await dialog.getByTestId("delete-confirm").click();
    await expect(page).toHaveURL(/\/account\/deleted(\?vibe=[a-z]+)?$/);
    await expect(page.getByRole("heading", { name: "Your account is deleted" })).toBeVisible();

    expect((await sql`select 1 from "user" where email = ${email}`).length).toBe(0);
    const [kept] = await sql<{ user_id: string | null; email: string }[]>`select user_id, email from orders where ref = ${ref}`;
    expect(kept).toEqual({ user_id: null, email });
    const audit = await sql`select 1 from admin_audit_log where action = 'customer.delete'`;
    expect(audit.length).toBeGreaterThan(0);

    // The session is gone: the account area asks for a login.
    await page.goto("/account");
    await expect(page).toHaveURL(/\/account\/login/);
    // No export without a session.
    expect((await page.request.get("/api/account/export")).status()).toBe(401);
  });
});

test.describe("robots", () => {
  test("/account is disallowed for crawlers", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(await res.text()).toMatch(/Disallow: \/account/);
  });
});
