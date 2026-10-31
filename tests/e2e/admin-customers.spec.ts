import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";

import { totp } from "./helpers/totp";

/**
 * Admin Customers e2e: search the list (accounts and guests), open a customer, export their data as JSON,
 * see the linked support cases and replacement on an order, and delete an account (the order stays, unlinked).
 *
 * - "gating" runs anywhere: /admin/customers without a session lands on the login page.
 * - "full flow" needs the dev stack (migrated + seeded database, `pnpm db:seed-products` for a variant to
 *   order). It is skipped unless E2E_ADMIN_FLOW=1. It creates its own owner (TOTP enrolled through the UI),
 *   inserts a customer account, a guest buyer, orders, a support case, a replacement order and a contact
 *   message straight into the database, then works as an admin would.
 *
 *     DATABASE_URL=... E2E_ADMIN_FLOW=1 E2E_BASE_URL=http://localhost:3106 \
 *       pnpm e2e tests/e2e/admin-customers.spec.ts --project=chromium-desktop
 */

test.describe("gating", () => {
  test("unauthenticated /admin/customers redirects to the login page", async ({ page }) => {
    await page.goto("/admin/customers");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

/** Next keeps the previous page mounted but hidden, so only look at what is on screen. */
const shown = (locator: Locator) => locator.locator("visible=true").first();

async function gotoLogin(page: Page) {
  await page.goto("/admin/login");
  await page.waitForLoadState("networkidle");
}

test.describe("full flow", () => {
  test.skip(!process.env.E2E_ADMIN_FLOW, "set E2E_ADMIN_FLOW=1 (needs the dev database)");
  test.describe.configure({ mode: "serial" });

  const stamp = Date.now();
  const email = `e2e-customers-${stamp}@ifonli.local`;
  const password = `E2e-Customers-${stamp}!`;
  const tag = stamp.toString(36).toUpperCase();
  const customer = {
    id: `e2e-cust-${stamp}`,
    name: `Meera Kapoor ${tag}`,
    email: `meera-${stamp}@example.com`,
    phone: "9876500011",
  };
  const guest = { name: `Gautam Mehta ${tag}`, email: `gautam-${stamp}@example.com` };
  const stateFile = path.join(tmpdir(), `ifonli-e2e-customers-${stamp}.json`);
  const refs = {
    first: `IFO-2611-${tag.slice(-3).padStart(3, "A")}1`,
    second: `IFO-2611-${tag.slice(-3).padStart(3, "A")}2`,
    replacement: `IFO-2611-${tag.slice(-3).padStart(3, "A")}3`,
    guest: `IFO-2611-${tag.slice(-3).padStart(3, "A")}4`,
  };
  const ids = { first: "", second: "", replacement: "", guest: "", caseId: "" };
  let secret = "";

  const withDb = async <T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL must point at the dev database");
    const sql = postgres(url, { max: 1 });
    try {
      return await fn(sql);
    } finally {
      await sql.end();
    }
  };

  test.beforeAll(async () => {
    execFileSync(
      "pnpm",
      [
        "exec",
        "tsx",
        "--conditions=react-server",
        "scripts/create-admin.ts",
        "--email",
        email,
        "--role",
        "owner",
        "--password",
        password,
      ],
      { stdio: "pipe" },
    );
    await withDb(async (sql) => {
      const [variant] = await sql<
        { id: string; product_id: string; sku: string; title: string; name: string; mrp: number }[]
      >`
        select v.id, v.product_id, v.sku, v.title, p.name, v.mrp_paise as mrp
        from variants v join products p on p.id = v.product_id
        where v.stock_on_hand >= 10 and v.price_paise <= v.mrp_paise
        order by v.sku limit 1`;
      if (!variant) throw new Error("No variant with stock found: run `pnpm db:seed-products`");
      const address = (name: string) => ({
        name,
        phone: "9876500011",
        line1: "12 Marine Drive",
        city: "Mumbai",
        state: "Maharashtra",
        stateCode: "27",
        pincode: "400001",
        country: "IN",
      });
      await sql`
        insert into "user" (id, name, email, email_verified, role)
        values (${customer.id}, ${customer.name}, ${customer.email}, true, 'customer')`;
      await sql`
        insert into customer_profiles (user_id, phone, marketing_opt_in)
        values (${customer.id}, ${customer.phone}, true)`;
      await sql`
        insert into addresses (user_id, name, phone, line1, city, state, pincode, is_default)
        values (${customer.id}, ${customer.name}, ${customer.phone}, '12 Marine Drive', 'Mumbai', 'Maharashtra', '400001', true)`;

      const mkOrder = async (
        ref: string,
        orderEmail: string,
        name: string,
        opts: { userId?: string; total: number; key?: string },
      ) => {
        const [order] = await sql<{ id: string }[]>`
          insert into orders (ref, user_id, email, phone, status, payment_status, fulfillment_status, payment_method,
            subtotal_paise, total_paise, shipping_address, idempotency_key)
          values (${ref}, ${opts.userId ?? null}, ${orderEmail}, '9876500011', 'completed', 'cod_collected', 'delivered', 'cod',
            ${opts.total}, ${opts.total}, ${sql.json(address(name))}, ${opts.key ?? `e2e-customers-${randomUUID()}`})
          returning id`;
        await sql`
          insert into order_items (order_id, variant_id, product_id, product_name, variant_title, sku, unit_price_paise,
            mrp_paise, qty, line_total_paise)
          values (${order!.id}, ${variant.id}, ${variant.product_id}, ${variant.name}, ${variant.title}, ${variant.sku},
            ${opts.total}, ${Math.max(variant.mrp, opts.total)}, 1, ${opts.total})`;
        return order!.id;
      };
      ids.first = await mkOrder(refs.first, customer.email, customer.name, { userId: customer.id, total: 59800 });
      ids.second = await mkOrder(refs.second, customer.email, customer.name, { userId: customer.id, total: 29900 });
      ids.guest = await mkOrder(refs.guest, guest.email, guest.name, { total: 19900 });
      const [kase] = await sql<{ id: string }[]>`
        insert into support_cases (order_id, type, description)
        values (${ids.first}, 'defective', 'The clasp does not close.') returning id`;
      ids.caseId = kase!.id;
      ids.replacement = await mkOrder(refs.replacement, customer.email, customer.name, {
        userId: customer.id,
        total: 0,
        key: `replacement:${ids.caseId}`,
      });
      await sql`
        insert into contact_messages (name, email, order_ref, message)
        values (${customer.name}, ${customer.email}, ${refs.first}, 'Where is my parcel? It is late.')`;
    });
  });

  test.afterAll(async () => {
    // Leave the shared dev database as found: everything this run created, in dependency order.
    await withDb(async (sql) => {
      const orderIds = [ids.first, ids.second, ids.replacement, ids.guest].filter(Boolean);
      if (orderIds.length) {
        await sql`delete from support_cases where order_id in ${sql(orderIds)}`;
        await sql`delete from order_items where order_id in ${sql(orderIds)}`;
        await sql`delete from order_events where order_id in ${sql(orderIds)}`;
        await sql`delete from orders where id in ${sql(orderIds)}`;
      }
      await sql`delete from contact_messages where email in ${sql([customer.email, guest.email])}`;
      await sql`delete from "user" where id = ${customer.id}`;
    });
  });

  test("sign in (enrol two-factor first)", async ({ page, isMobile }) => {
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
    await expect(page.getByRole("heading", { name: "Save your backup codes" })).toBeVisible();
    await page.getByRole("button", { name: /I have saved them/ }).click();
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
    // One TOTP code can only be used once per 30 s window, so the other tests reuse this session.
    await page.context().storageState({ path: stateFile });
  });

  test.describe("signed in", () => {
    test.use({ storageState: stateFile });

    test("search finds an account and a guest, but never staff", async ({ page, isMobile }) => {
      test.skip(isMobile, "desktop only");
      await page.goto("/admin/customers");
      await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
      // The account menu's accessible name starts with its purpose and includes the visible user name.
      await expect(page.getByRole("button", { name: /^Account menu:.*Owner/ })).toBeVisible();
      const search = page.getByRole("searchbox", { name: "Search customers" });

      await search.fill(tag);
      await search.press("Enter");
      await expect(page).toHaveURL(/q=/);
      const accountRow = shown(page.getByRole("row", { name: new RegExp(customer.name) }));
      await expect(accountRow).toBeVisible();
      await expect(accountRow).toContainText("Account");
      await expect(accountRow).toContainText(customer.email);
      // Two counted orders (the no-charge replacement is not a sale): 598 + 299 rupees.
      await expect(accountRow).toContainText("2");
      await expect(accountRow).toContainText("₹897");
      const guestRow = shown(page.getByRole("row", { name: new RegExp(guest.name) }));
      await expect(guestRow).toBeVisible();
      await expect(guestRow).toContainText("Guest");
      await expect(guestRow).toContainText("₹199");

      // Narrow by e-mail fragment and by phone.
      await search.fill(`meera-${stamp}`);
      await search.press("Enter");
      await expect(shown(page.getByRole("row", { name: new RegExp(customer.name) }))).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(guest.name) })).toHaveCount(0);
      await search.fill("98765 00011");
      await search.press("Enter");
      await expect(shown(page.getByRole("row", { name: new RegExp(customer.name) }))).toBeVisible();

      // The signed-in owner is staff, not a customer.
      await search.fill(email);
      await search.press("Enter");
      await expect(page.getByText("No customers match this search.")).toBeVisible();
    });

    test("no serious accessibility violations on the list, a detail page and the delete dialog", async ({
      page,
      isMobile,
    }) => {
      test.skip(isMobile, "desktop only");
      const scan = async (what: string) => {
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const bad = results.violations.filter(
          (v) => v.impact === "serious" || v.impact === "critical",
        );
        expect(
          bad.map((v) => `${what} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
        ).toEqual([]);
      };
      await page.goto(`/admin/customers?q=${tag}`);
      await expect(shown(page.getByRole("row", { name: new RegExp(customer.name) }))).toBeVisible();
      await scan("list");
      await page.goto(`/admin/customers/${customer.id}`);
      await expect(page.getByRole("heading", { name: customer.name })).toBeVisible();
      await scan("detail");
      await page.getByRole("button", { name: "Delete account" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await scan("delete dialog");
      await page.keyboard.press("Escape");
    });

    test("opens a customer: profile, orders, support and messages link through", async ({ page, isMobile }) => {
      test.skip(isMobile, "desktop only");
      await page.goto(`/admin/customers?q=${tag}`);
      await shown(page.getByRole("link", { name: new RegExp(customer.name) })).click();
      await expect(page).toHaveURL(new RegExp(`/admin/customers/${customer.id}(\\?|$)`));
      await expect(page.getByRole("heading", { name: customer.name })).toBeVisible();

      const profile = page.getByRole("heading", { name: "Profile" }).locator("xpath=ancestor::*[contains(@class,'rounded')][1]");
      await expect(profile).toContainText(customer.email);
      await expect(profile).toContainText(customer.phone);
      await expect(profile).toContainText("Opted in");

      await expect(page.getByRole("heading", { name: "Saved addresses" })).toBeVisible();
      await expect(page.getByText("12 Marine Drive").first()).toBeVisible();

      // Orders link to the admin order page; the replacement is marked.
      const orders = page.getByRole("heading", { name: "Orders", exact: true }).locator("xpath=ancestor::*[contains(@class,'rounded')][1]");
      await expect(orders.getByRole("link", { name: refs.first })).toHaveAttribute("href", `/admin/orders/${ids.first}`);
      await expect(orders.getByRole("link", { name: refs.second })).toBeVisible();
      await expect(orders.getByText("Replacement", { exact: true })).toBeVisible();

      // Support: the case and the contact message link to the support module.
      await expect(page.getByRole("link", { name: ids.caseId.slice(0, 8).toUpperCase() })).toHaveAttribute(
        "href",
        `/admin/support/cases/${ids.caseId}`,
      );
      await expect(page.getByRole("link", { name: /Where is my parcel/ })).toHaveAttribute(
        "href",
        /\/admin\/support\/messages\/[0-9a-f-]{36}$/,
      );
    });

    test("exports a customer's data as JSON, and the export is audited", async ({ page, isMobile }) => {
      test.skip(isMobile, "desktop only");
      await page.goto(`/admin/customers/${customer.id}`);
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Export data" }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/^ifonli-customer-account-.+\.json$/);
      const data = JSON.parse(await readFile(await download.path(), "utf8"));
      expect(data.account).toMatchObject({ id: customer.id, email: customer.email, name: customer.name });
      expect(data.profile).toMatchObject({ phone: customer.phone, marketingOptIn: true });
      expect(data.addresses).toHaveLength(1);
      expect(data.orders.map((o: { ref: string }) => o.ref).sort()).toEqual(
        [refs.first, refs.second, refs.replacement].sort(),
      );
      expect(data.supportCases).toHaveLength(1);
      expect(data.contactMessages).toHaveLength(1);

      await expect
        .poll(async () =>
          withDb(async (sql) => {
            const rows = await sql<{ diff: Record<string, unknown> }[]>`
              select diff from admin_audit_log where action = 'customer.export' and entity_id = ${customer.id}`;
            return rows.length;
          }),
        )
        .toBe(1);
      const [audit] = await withDb(
        (sql) => sql<{ diff: unknown }[]>`select diff from admin_audit_log where action = 'customer.export' and entity_id = ${customer.id}`,
      );
      expect(JSON.stringify(audit!.diff)).not.toContain(customer.email);
    });

    test("a guest can be exported but not deleted, and the page explains why", async ({ page, isMobile }) => {
      test.skip(isMobile, "desktop only");
      await page.goto(`/admin/customers?q=${tag}`);
      await shown(page.getByRole("link", { name: new RegExp(guest.name) })).click();
      await expect(page).toHaveURL(/\/admin\/customers\/o-[0-9a-f-]{36}(\?|$)/);
      await expect(page.getByRole("heading", { name: guest.name })).toBeVisible();
      await expect(page.getByText("This guest has no account to delete.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete account" })).toHaveCount(0);

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Export data" }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/^ifonli-customer-guest-.+\.json$/);
      const data = JSON.parse(await readFile(await download.path(), "utf8"));
      expect(data.guest).toEqual({ email: guest.email });
      expect(data.orders.map((o: { ref: string }) => o.ref)).toEqual([refs.guest]);
    });

    test("the order page lists its support case, the replacement, and links back", async ({ page, isMobile }) => {
      test.skip(isMobile, "desktop only");
      await page.goto(`/admin/orders/${ids.first}`);
      await expect(page.getByRole("heading", { name: refs.first })).toBeVisible();
      const card = page.getByRole("heading", { name: "Support and replacements" }).locator("xpath=ancestor::*[contains(@class,'rounded')][1]");
      await expect(card.getByRole("link", { name: ids.caseId.slice(0, 8).toUpperCase() })).toHaveAttribute(
        "href",
        `/admin/support/cases/${ids.caseId}`,
      );
      await expect(card).toContainText("Defective");
      await expect(card).toContainText("Open");
      // Header link and card link both lead to the replacement order.
      await expect(page.getByRole("link", { name: `Replacement order ${refs.replacement}` }).first()).toHaveAttribute(
        "href",
        `/admin/orders/${ids.replacement}`,
      );
      await expect(page.getByRole("link", { name: "View customer" })).toHaveAttribute(
        "href",
        `/admin/customers/${customer.id}`,
      );

      await page.getByRole("link", { name: `Replacement order ${refs.replacement}` }).first().click();
      await expect(page).toHaveURL(new RegExp(`/admin/orders/${ids.replacement}(\\?|$)`));
      await expect(page.getByRole("heading", { name: refs.replacement })).toBeVisible();
      await expect(page.getByRole("link", { name: `Replacement for ${refs.first}` }).first()).toHaveAttribute(
        "href",
        `/admin/orders/${ids.first}`,
      );
    });

    test("deletes an account after a typed confirmation; the orders stay, unlinked", async ({ page, isMobile }) => {
      test.skip(isMobile, "desktop only");
      await page.goto(`/admin/customers/${customer.id}`);
      await page.getByRole("button", { name: "Delete account" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const confirm = dialog.getByRole("button", { name: "Delete account" });
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel(new RegExp(`Type ${customer.email}`)).fill("someone-else@example.com");
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel(new RegExp(`Type ${customer.email}`)).fill(customer.email.toUpperCase());
      await expect(confirm).toBeEnabled();
      await confirm.click();
      await expect(page).toHaveURL(/\/admin\/customers(\?|$)/);
      await expect(page.getByText(/Account deleted/)).toBeVisible();

      await withDb(async (sql) => {
        const users = await sql`select 1 from "user" where id = ${customer.id}`;
        expect(users).toHaveLength(0);
        const kept = await sql<{ ref: string; user_id: string | null }[]>`
          select ref, user_id from orders where id in ${sql([ids.first, ids.second, ids.replacement])} order by ref`;
        expect(kept.map((o) => o.ref)).toEqual([refs.first, refs.second, refs.replacement].sort());
        expect(kept.every((o) => o.user_id === null)).toBe(true);
        const audit = await sql<{ diff: Record<string, unknown> }[]>`
          select diff from admin_audit_log where action = 'customer.delete' and entity_id = ${customer.id}`;
        expect(audit).toHaveLength(1);
        expect(audit[0]!.diff).toMatchObject({ by: "staff", ordersRetained: 3 });
        expect(JSON.stringify(audit[0]!.diff)).not.toContain(customer.email);
      });

      // The buyer is still on file as a guest (their orders are records), and the old link is gone.
      await page.goto(`/admin/customers?q=${tag}`);
      const row = shown(page.getByRole("row", { name: new RegExp(customer.email) }));
      await expect(row).toBeVisible();
      await expect(row).toContainText("Guest");
      await page.goto(`/admin/customers/${customer.id}`);
      await expect(page.getByRole("button", { name: "Export data" })).toHaveCount(0);
      await expect(page.locator("h1").filter({ hasText: customer.name })).toHaveCount(0);
    });
  });
});
