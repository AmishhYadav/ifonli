import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { config } from "dotenv";
import postgres from "postgres";

/**
 * Customer accounts e2e: email-OTP sign-in, guest-order attach, profile, addresses, order history,
 * checkout prefill, wishlist sync, data export, sign-out and account deletion. Needs the dev server
 * (sign-in codes are written to `.dev-mail/` only outside production) and the local dev database
 * with the product seed:
 *
 *   NEXT_DIST_DIR=.next-a pnpm exec next dev -p 3101
 *   E2E_BASE_URL=http://localhost:3101 pnpm e2e tests/e2e/account.spec.ts --project=chromium-desktop
 *
 * Setup writes commerce settings and pincode rows through SQL (restored afterwards), places a real
 * guest COD order through the checkout UI, and removes everything it created (orders and users for
 * e2e-account-*@example.com). Run it on one project at a time: it owns those rows while it runs.
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

const PINCODE = "400001"; // Mumbai
const SKU = "PH-CHARM-HEART-LILAC";
const EMAIL_PREFIX = "e2e-account-";
const MAIL_DIR = path.join(process.cwd(), ".dev-mail");

interface Snapshot {
  settings: { key: string; value: unknown; is_placeholder: boolean }[];
  pincode: { cod_allowed: boolean; serviceable: boolean } | undefined;
  variantId: string;
  stock: number;
}
let snapshot: Snapshot;
const createdUserIds = new Set<string>();

const email = `${EMAIL_PREFIX}${randomBytes(4).toString("hex")}@example.com`;
let orderRef = "";

async function cleanup() {
  const ids = sql`(select id from orders where lower(email) like ${EMAIL_PREFIX + "%"})`;
  await sql`delete from notification_outbox where order_id in ${ids}`;
  await sql`delete from inventory_movements where order_id in ${ids}`;
  await sql`delete from invoices where order_id in ${ids}`;
  await sql`delete from payments where order_id in ${ids}`;
  await sql`delete from orders where lower(email) like ${EMAIL_PREFIX + "%"}`;
  const users = await sql<
    { id: string }[]
  >`select id from "user" where email like ${EMAIL_PREFIX + "%"}`;
  const all = new Set([...createdUserIds, ...users.map((u) => u.id)]);
  if (all.size > 0) {
    const list = [...all];
    await sql`delete from carts where user_id in ${sql(list)}`;
    await sql`delete from admin_audit_log where entity_id in ${sql(list)}`;
    await sql`delete from "user" where id in ${sql(list)}`;
  }
  await sql`delete from carts where token like 'e2e-%'`;
  await sql`delete from rate_limits where key like any(array['login-%','pincode:%','checkout:%','export:%','account-delete:%'])`;
  await sql`delete from verification where identifier like ${"%" + EMAIL_PREFIX + "%"}`;
}

test.beforeAll(async () => {
  const keys = Object.keys(TEST_SETTINGS);
  const settingRows = await sql<
    Snapshot["settings"]
  >`select key, value, is_placeholder from settings where key in ${sql(keys)}`;
  const [pin] = await sql<
    { cod_allowed: boolean; serviceable: boolean }[]
  >`select cod_allowed, serviceable from pincodes where pincode = ${PINCODE}`;
  const [variant] = await sql<
    { id: string; stock_on_hand: number }[]
  >`select id, stock_on_hand from variants where sku = ${SKU}`;
  if (!variant) throw new Error(`Seed variant ${SKU} not found: run pnpm db:seed-products`);
  snapshot = {
    settings: settingRows,
    pincode: pin,
    variantId: variant.id,
    stock: variant.stock_on_hand,
  };
  for (const [key, value] of Object.entries(TEST_SETTINGS)) {
    await sql`
      insert into settings (key, value, is_placeholder) values (${key}, ${sql.json(value as never)}, false)
      on conflict (key) do update set value = excluded.value, is_placeholder = false`;
  }
  await sql`update pincodes set cod_allowed = true, serviceable = true where pincode = ${PINCODE}`;
  await sql`update variants set stock_on_hand = 200 where id = ${variant.id}`;
  await cleanup();
});

test.afterAll(async () => {
  await cleanup();
  const had = new Set(snapshot.settings.map((s) => s.key));
  for (const key of Object.keys(TEST_SETTINGS)) {
    if (!had.has(key)) await sql`delete from settings where key = ${key}`;
  }
  for (const s of snapshot.settings) {
    await sql`update settings set value = ${sql.json(s.value as never)}, is_placeholder = ${s.is_placeholder} where key = ${s.key}`;
  }
  if (snapshot.pincode) {
    await sql`update pincodes set cod_allowed = ${snapshot.pincode.cod_allowed}, serviceable = ${snapshot.pincode.serviceable} where pincode = ${PINCODE}`;
  }
  await sql`update variants set stock_on_hand = ${snapshot.stock} where id = ${snapshot.variantId}`;
  await sql.end();
});

// One flow, in order: later steps use the account and the order the earlier ones created.
test.describe.configure({ mode: "serial" });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "run with --project=chromium-desktop");
});
test.setTimeout(120_000);

/** A guest cart with the test product, wired to the browser through the `cart_token` cookie. */
async function seedCart(context: BrowserContext, baseURL: string, qty = 1) {
  const token = `e2e-${randomBytes(18).toString("base64url")}`;
  const [cart] = await sql<{ id: string }[]>`
    insert into carts (token, expires_at) values (${token}, now() + interval '1 day') returning id`;
  await sql`insert into cart_items (cart_id, variant_id, qty) values (${cart!.id}, ${snapshot.variantId}, ${qty})`;
  await context.addCookies([{ name: "cart_token", value: token, url: baseURL }]);
}

/** The newest sign-in code mailed to `to` (the dev mail channel writes each e-mail to `.dev-mail/`). */
async function latestCode(to: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const files = readdirSync(MAIL_DIR)
      .filter((f) => f.endsWith(".txt"))
      .sort()
      .reverse();
    for (const file of files.slice(0, 40)) {
      const text = readFileSync(path.join(MAIL_DIR, file), "utf8");
      if (!text.startsWith(`To: ${to}\n`)) continue;
      const match = text.match(/^Subject: (\d{6}) is your sign-in code/m);
      if (match) return match[1]!;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No sign-in code was mailed to ${to}`);
}

async function userIdFor(address: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`select id from "user" where email = ${address}`;
  if (!row) throw new Error(`No user for ${address}`);
  createdUserIds.add(row.id);
  return row.id;
}

/** Sends the code from the login page's first step and returns the code read from the mailbox. */
async function requestCode(page: Page, address: string, query = ""): Promise<string> {
  await page.goto(`/account/login${query}`);
  await page.waitForLoadState("networkidle");
  const input = page.getByLabel("Email");
  await input.fill(address);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByTestId("code-sent")).toContainText(address);
  return latestCode(address);
}

async function signIn(page: Page, address: string, query = ""): Promise<void> {
  const code = await requestCode(page, address, query);
  await page.getByLabel("Sign-in code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("staff accounts", () => {
  const adminEmail = `${EMAIL_PREFIX}admin-${randomBytes(4).toString("hex")}@example.com`;
  const adminPassword = `E2e-Admin-${randomBytes(6).toString("hex")}!`;

  test.beforeAll(() => {
    execFileSync(
      "pnpm",
      [
        "exec",
        "tsx",
        "--conditions=react-server",
        "scripts/create-admin.ts",
        "--email",
        adminEmail,
        "--role",
        "admin",
        "--password",
        adminPassword,
      ],
      { stdio: "pipe" },
    );
  });

  test("an admin address is sent to the admin sign-in instead of getting a code", async ({
    page,
  }) => {
    await page.goto("/account/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByRole("button", { name: "Email me a code" }).click();
    await expect(page.getByText("Admin accounts sign in at /admin/login.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the admin sign-in" })).toHaveAttribute(
      "href",
      "/admin/login",
    );
    await expect(page.getByTestId("code-sent")).toHaveCount(0);
  });

  test("an admin session that opens /account sees a notice, not customer data", async ({
    page,
  }) => {
    await page.goto("/admin/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill(adminPassword);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/admin\/enroll-2fa/);

    await page.goto("/account/orders");
    await expect(page).toHaveURL(/\/account\/admin-session/);
    await expect(page.getByRole("heading", { name: "You're signed in as staff" })).toBeVisible();
    await expect(page.getByTestId("orders-list")).toHaveCount(0);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/account\/admin-session/);
    const res = await page.request.get("/api/account/export");
    expect(res.status()).toBe(401);
  });
});

test.describe("gating", () => {
  test("signed-out visitors are sent to the login page and brought back afterwards", async ({
    page,
  }) => {
    await page.goto("/account/orders");
    await expect(page).toHaveURL(/\/account\/login\?next=%2Faccount%2Forders/);
    await expect(page.getByRole("heading", { name: "Sign in or create an account" })).toBeVisible();
    await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);
  });

  test("the account area is not cached", async ({ request }) => {
    const res = await request.get("/account/login");
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(res.headers()["x-robots-tag"]).toContain("noindex");
  });

  test("the export route needs a session", async ({ request }) => {
    const res = await request.get("/api/account/export", { maxRedirects: 0 });
    expect(res.status()).toBe(401);
  });
});

/**
 * One signed-in browser for the whole flow (Playwright gives every test a fresh context, so the
 * session, cookies and localStorage are shared here on purpose).
 */
test.describe("account flow", () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext({ baseURL: baseURL! });
    page = await context.newPage();
  });
  test.afterAll(async () => {
    await context.close();
  });

  test.describe("guest order, then sign in", () => {
    test("a guest places a COD order and is offered an account with the email prefilled", async ({
      baseURL,
    }) => {
      await seedCart(context, baseURL!);
      await page.goto("/checkout");
      await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false", {
        timeout: 30_000,
      });
      await page
        .getByLabel("Email")
        .fill(email.toUpperCase().replace("@EXAMPLE.COM", "@example.com"));
      await page.getByLabel("Mobile number").fill("98765 43210");
      await page.getByLabel("Pincode").fill(PINCODE);
      await expect(page.getByLabel("City")).not.toHaveValue("");
      await page.getByLabel("Full name").fill("Asha Rao");
      await page.getByLabel("House or flat number and street").fill("12 Marine Drive");
      await page.getByRole("checkbox", { name: /I have read and agree/ }).check();
      await page.getByRole("radio", { name: /Cash on delivery/ }).check();
      await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false");
      await page.getByRole("button", { name: /^Place COD order/ }).click();

      await expect(page).toHaveURL(/\/orders\/IFO-[0-9A-Z-]+\?t=/);
      orderRef = new URL(page.url()).pathname.split("/").pop()!;
      await expect(page.getByTestId("order-status")).toHaveText("Confirmed");

      const cta = page
        .getByTestId("order-later-actions")
        .getByRole("link", { name: "Create an account" });
      await expect(cta).toBeVisible();
      const href = (await cta.getAttribute("href"))!;
      expect(href).toContain(`email=${encodeURIComponent(email)}`);
      expect(href).toContain(`next=${encodeURIComponent(`/account/orders/${orderRef}`)}`);
      await cta.click();

      await expect(page).toHaveURL(/\/account\/login\?email=/);
      // Cache Components keeps the previous page mounted but hidden: only the visible field counts.
      await expect(page.locator('input[name="email"]:visible')).toHaveValue(email);
    });

    test("a wrong code says so; the right one signs in, attaches the guest order and keeps the new cart", async ({
      baseURL,
    }) => {
      // A cart built while signed out: it is merged into the account on sign-in.
      await seedCart(context, baseURL!, 2);
      const next = `/account/orders/${orderRef}`;
      const code = await requestCode(
        page,
        email,
        `?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`,
      );

      const wrong = code === "000000" ? "111111" : "000000";
      await page.getByLabel("Sign-in code").fill(wrong);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByText("That code isn't right")).toBeVisible();
      await expect(page.getByLabel("Sign-in code")).toHaveValue("");

      // Resend is on cooldown right after sending.
      await expect(page.getByTestId("resend")).toBeDisabled();

      await page.getByLabel("Sign-in code").fill(code);
      await page.getByRole("button", { name: "Sign in" }).click();

      // `next` is honoured: straight to the order, which is now in the account.
      await expect(page).toHaveURL(new RegExp(`/account/orders/${orderRef}(\\?|$)`));
      await expect(page.getByTestId("order-ref")).toHaveText(orderRef);
      await expect(page.getByTestId("account-email")).toHaveText(email);

      const userId = await userIdFor(email);
      const [attached] = await sql<
        { user_id: string | null }[]
      >`select user_id from orders where ref = ${orderRef}`;
      expect(attached?.user_id).toBe(userId);

      // The account view offers the invoice (the order is confirmed) and no guest "create account".
      await expect(page.getByRole("link", { name: "Download invoice" })).toHaveAttribute(
        "href",
        `/api/account/orders/${orderRef}/invoice`,
      );
      await expect(page.getByRole("link", { name: "Create an account" })).toHaveCount(0);

      // The cart built while signed out is now the account's cart.
      await page.goto("/cart");
      await expect(page.getByText("Heart charm").first()).toBeVisible();
      const [cart] = await sql<{ n: number }[]>`
      select coalesce(sum(ci.qty), 0)::int as n from carts c join cart_items ci on ci.cart_id = c.id where c.user_id = ${userId}`;
      expect(cart?.n).toBe(2);
    });

    test("the attached guest order is in the order history", async () => {
      await page.goto(`/account/orders`);
      await expect(page.getByTestId("orders-list").getByTestId("order-row")).toHaveCount(1);
      await expect(page.getByTestId("order-row")).toContainText(orderRef);
      await expect(page.getByTestId("order-row")).toContainText("Confirmed");
    });

    test("an order in another account is not found", async () => {
      await page.goto("/account/orders/IFO-0000-NOPE");
      await expect(page.getByTestId("order-not-found")).toBeVisible();
    });
  });

  test.describe("profile and addresses", () => {
    test("overview greets by name once the profile has one", async () => {
      await page.goto("/account");
      await expect(page.getByTestId("account-greeting")).toHaveText("Welcome");
      await page.goto("/account/profile");
      const marketing = page.getByRole("checkbox", { name: /Send me news and offers/ });
      await expect(marketing).not.toBeChecked();
      await page.getByLabel("Name").fill("Asha Rao");
      await page.getByLabel("Mobile number").fill("12345");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Enter a 10-digit Indian mobile number")).toBeVisible();
      await page.getByLabel("Mobile number").fill("98765 43210");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Profile saved")).toBeVisible();
      await page.goto("/account");
      await expect(page.getByTestId("account-greeting")).toHaveText("Hi, Asha");
      const [profile] = await sql<{ phone: string | null; marketing_opt_in: boolean }[]>`
      select phone, marketing_opt_in from customer_profiles where user_id = ${await userIdFor(email)}`;
      expect(profile).toEqual({ phone: "+919876543210", marketing_opt_in: false });
    });

    test("adds, edits, defaults and deletes addresses", async () => {
      await page.goto("/account/addresses");
      await expect(page.getByText("No saved addresses yet")).toBeVisible();
      await page.getByRole("button", { name: "Add an address" }).click();

      const form = page.getByTestId("address-form");
      await form.getByRole("button", { name: "Add address" }).click();
      await expect(form.getByText("Enter the recipient's full name")).toBeVisible();

      await form.getByLabel("Full name").fill("Asha Rao");
      await form.getByLabel("Mobile number").fill("98765 43210");
      await form.getByLabel("Pincode").fill(PINCODE);
      await expect(form.getByLabel("City")).toHaveValue("Mumbai");
      await expect(form.getByLabel("State")).toHaveValue("Maharashtra");
      await form.getByLabel("House or flat number and street").fill("12 Marine Drive");
      await form.getByRole("button", { name: "Add address" }).click();

      const cards = page.getByTestId("address-card");
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText("12 Marine Drive");
      await expect(cards.first()).toContainText("Default");

      // A second address, made the default.
      await page.getByRole("button", { name: "Add an address" }).click();
      const second = page.getByTestId("address-form");
      await second.getByLabel("Full name").fill("Ravi Rao");
      await second.getByLabel("Mobile number").fill("9123456789");
      await second.getByLabel("Pincode").fill(PINCODE);
      await expect(second.getByLabel("City")).toHaveValue("Mumbai");
      await second.getByLabel("House or flat number and street").fill("7 Hill Road");
      await second.getByRole("checkbox", { name: "Make this my default address" }).check();
      await second.getByRole("button", { name: "Add address" }).click();
      await expect(cards).toHaveCount(2);
      await expect(cards.first()).toContainText("7 Hill Road");
      await expect(cards.first()).toContainText("Default");
      await expect(cards.nth(1)).not.toContainText("Default");

      // Edit the second one, then switch the default back to it.
      await cards.nth(1).getByRole("button", { name: /^Edit/ }).click();
      await page.getByTestId("address-form").getByLabel("Landmark").fill("Near the sea");
      await page.getByTestId("address-form").getByRole("button", { name: "Save address" }).click();
      await expect(page.getByText("Near the sea")).toBeVisible();
      await cards
        .nth(1)
        .getByRole("button", { name: /^Make default/ })
        .click();
      await expect(cards.first()).toContainText("12 Marine Drive");
      await expect(cards.first()).toContainText("Default");

      const userId = await userIdFor(email);
      const defaults = await sql`select id from addresses where user_id = ${userId} and is_default`;
      expect(defaults).toHaveLength(1);

      // Delete the non-default one.
      await cards
        .nth(1)
        .getByRole("button", { name: /^Delete/ })
        .click();
      await expect(cards).toHaveCount(1);
    });

    test("checkout is prefilled from the account", async ({ baseURL }) => {
      await seedCart(context, baseURL!);
      await page.goto("/checkout");
      await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false", {
        timeout: 30_000,
      });
      await expect(page.getByLabel("Email")).toHaveValue(email);
      await expect(page.getByLabel("Mobile number")).toHaveValue("+919876543210");
      await expect(page.getByLabel("Full name")).toHaveValue("Asha Rao");
      await expect(page.getByLabel("Pincode")).toHaveValue(PINCODE);
      await expect(page.getByLabel("House or flat number and street")).toHaveValue(
        "12 Marine Drive",
      );
      await expect(page.getByLabel("City")).toHaveValue("Mumbai");
      // The policy box is never pre-ticked.
      await expect(page.getByRole("checkbox", { name: /I have read and agree/ })).not.toBeChecked();
    });
  });

  test.describe("wishlist sync", () => {
    test("hearts are saved to the account, and a new device sees them after signing in", async ({
      browser,
      baseURL,
    }) => {
      const userId = await userIdFor(email);
      await page.goto("/shop");
      const heart = page.getByTestId("wishlist-heart").first();
      await expect(heart).toHaveAttribute("aria-pressed", "false");
      await heart.click();
      await expect(heart).toHaveAttribute("aria-pressed", "true");
      await expect
        .poll(
          async () => (await sql`select 1 from wishlist_items where user_id = ${userId}`).length,
          { timeout: 15_000 },
        )
        .toBe(1);

      // A second "device": empty localStorage, then sign in.
      const device2 = await browser.newContext({ baseURL: baseURL! });
      try {
        const page2 = await device2.newPage();
        await signIn(page2, email);
        await expect(page2).toHaveURL(/\/account(\?|$)/);
        await page2.goto("/wishlist");
        await expect(page2.getByTestId("wishlist-grid")).toBeVisible({ timeout: 20_000 });
        await expect(page2.getByTestId("wishlist-grid").getByTestId("wishlist-heart")).toHaveCount(
          1,
        );
      } finally {
        await device2.close();
      }
    });
  });

  test.describe("data export", () => {
    test("downloads the customer's own data with no internal ids", async () => {
      await page.goto("/account/privacy");
      await expect(page.getByTestId("export-link")).toHaveAttribute("href", "/api/account/export");
      const res = await page.request.get("/api/account/export");
      expect(res.status()).toBe(200);
      expect(res.headers()["content-disposition"]).toContain("attachment");
      const body = await res.text();
      const data = JSON.parse(body);
      expect(data.account.email).toBe(email);
      expect(data.profile.phone).toBe("+919876543210");
      expect(data.addresses).toHaveLength(1);
      expect(data.orders.map((o: { reference: string }) => o.reference)).toEqual([orderRef]);
      expect(data.wishlist).toHaveLength(1);
      expect(body).not.toContain(await userIdFor(email));
    });
  });

  test.describe("sign out", () => {
    test("ends the session and the gate closes again", async () => {
      await page.goto("/account");
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/localhost:\d+\/(\?|$)/);
      expect((await context.cookies()).find((c) => c.name === "ifonli_acct")).toBeUndefined();
      await page.goto("/account");
      await expect(page).toHaveURL(/\/account\/login/);
      const res = await page.request.get("/api/account/export");
      expect(res.status()).toBe(401);
    });

    test("an off-site next parameter is ignored after sign-in", async () => {
      await signIn(page, email, `?next=${encodeURIComponent("//evil.example/phish")}`);
      await expect(page).toHaveURL(/\/account(\?|$)/);
      await expect(page.getByTestId("account-email")).toHaveText(email);
    });
  });

  test.describe("delete account", () => {
    test("needs the word typed, removes personal data, keeps the order detached", async () => {
      const userId = await userIdFor(email);
      await page.goto("/account/privacy");
      const del = page.getByRole("button", { name: "Delete my account" });
      await expect(del).toBeDisabled();
      await page.getByLabel("Type DELETE to confirm").fill("delete");
      await del.click();

      await expect(page).toHaveURL(/localhost:\d+\/(\?|$)/);
      await expect(page.getByText("Your account has been deleted")).toBeVisible();
      expect((await context.cookies()).find((c) => c.name === "ifonli_acct")).toBeUndefined();

      const [u] = await sql<{ email: string; name: string; banned: boolean }[]>`
      select email, name, banned from "user" where id = ${userId}`;
      expect(u?.email).toBe(`deleted-${userId}@deleted.invalid`);
      expect(u?.name).toBe("Deleted customer");
      expect(u?.banned).toBe(true);
      expect(await sql`select 1 from addresses where user_id = ${userId}`).toHaveLength(0);
      expect(await sql`select 1 from wishlist_items where user_id = ${userId}`).toHaveLength(0);
      expect(await sql`select 1 from session where user_id = ${userId}`).toHaveLength(0);
      const [o] = await sql<
        { user_id: string | null; email: string }[]
      >`select user_id, email from orders where ref = ${orderRef}`;
      expect(o).toEqual({ user_id: null, email });
      const [profile] = await sql<{ deleted_at: Date | null; phone: string | null }[]>`
      select deleted_at, phone from customer_profiles where user_id = ${userId}`;
      expect(profile?.deleted_at).not.toBeNull();
      expect(profile?.phone).toBeNull();

      // The session is gone, and the same address can start over as a new, empty account.
      await page.goto("/account");
      await expect(page).toHaveURL(/\/account\/login/);
      await signIn(page, email);
      await expect(page).toHaveURL(/\/account(\?|$)/);
      await expect(page.getByTestId("account-greeting")).toHaveText("Welcome");
      const newId = await userIdFor(email);
      expect(newId).not.toBe(userId);
      // Orders still carry the e-mail, so the guest-order attach re-links them to the new account.
      await page.goto("/account/orders");
      await expect(page.getByTestId("order-row")).toHaveCount(1);
    });
  });
});
