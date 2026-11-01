import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";

import { createAdminAccount } from "./helpers/admin-account";
import { totp } from "./helpers/totp";

/**
 * Admin Support e2e: the contact inbox and the support cases (reply, assign, resolve with a refund or a
 * replacement, reject).
 *
 * - "gating" runs anywhere: /admin/support without a session lands on the login page.
 * - "full flow" needs the dev stack (migrated + seeded database, `pnpm db:seed-products` for a variant to
 *   order). It is skipped unless E2E_ADMIN_FLOW=1. It creates its own owner (TOTP enrolled through the UI),
 *   inserts a delivered cash-on-delivery order and three cases straight into the database (the customer
 *   form is another module), then works them as an admin would.
 *
 *     DATABASE_URL=... E2E_ADMIN_FLOW=1 E2E_BASE_URL=http://localhost:3102 \
 *       pnpm e2e tests/e2e/admin-support.spec.ts --project=chromium-desktop
 */

test.describe("gating", () => {
  test("unauthenticated /admin/support redirects to the login page", async ({ page }) => {
    await page.goto("/admin/support");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

/** Next keeps the previous page mounted but hidden, so only look at what is on screen. */
const shown = (locator: Locator) => locator.locator("visible=true").first();

async function gotoLogin(page: Page) {
  await page.goto("/admin/login");
  await page.waitForLoadState("networkidle");
}

async function pickOption(
  page: Page,
  label: string | RegExp,
  option: string | RegExp,
  scope: Pick<Page, "getByRole"> = page,
) {
  await scope.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option }).click();
}

test.describe("full flow", () => {
  test.skip(!process.env.E2E_ADMIN_FLOW, "set E2E_ADMIN_FLOW=1 (needs the dev database)");
  test.describe.configure({ mode: "serial" });

  const stamp = Date.now();
  const email = `e2e-support-${stamp}@ifonli.local`;
  const password = `E2e-Support-${stamp}!`;
  const customerEmail = `shopper-${stamp}@example.com`;
  const orderRef = `IFO-2611-${stamp.toString(36).slice(-4).toUpperCase().padStart(4, "X")}`;
  const stateFile = path.join(tmpdir(), `ifonli-e2e-support-${stamp}.json`);
  let secret = "";
  let orderId = "";
  const cases = { refund: "", replacement: "", reject: "" };
  let messageId = "";

  test.beforeAll(async () => {
    createAdminAccount(email, password, "owner");
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL must point at the dev database");
    const sql = postgres(url, { max: 1 });
    try {
      const [variant] = await sql<
        { id: string; product_id: string; sku: string; title: string; name: string; mrp: number }[]
      >`
        select v.id, v.product_id, v.sku, v.title, p.name, v.mrp_paise as mrp
        from variants v join products p on p.id = v.product_id
        where v.stock_on_hand >= 10 and v.price_paise <= v.mrp_paise
        order by v.sku limit 1`;
      if (!variant) throw new Error("No variant with stock found: run `pnpm db:seed-products`");
      const address = {
        name: "Asha Rao",
        phone: "9876543210",
        line1: "12 Marine Drive",
        city: "Mumbai",
        state: "Maharashtra",
        stateCode: "27",
        pincode: "400001",
        country: "IN",
      };
      const [order] = await sql<{ id: string }[]>`
        insert into orders (ref, email, phone, status, payment_status, fulfillment_status, payment_method,
          subtotal_paise, total_paise, shipping_address, idempotency_key)
        values (${orderRef}, ${customerEmail}, '9876543210', 'completed', 'cod_collected', 'delivered', 'cod',
          59800, 59800, ${sql.json(address)}, ${`e2e-support-${randomUUID()}`})
        returning id`;
      orderId = order!.id;
      await sql`
        insert into order_items (order_id, variant_id, product_id, product_name, variant_title, sku, unit_price_paise,
          mrp_paise, qty, line_total_paise)
        values (${orderId}, ${variant.id}, ${variant.product_id}, ${variant.name}, ${variant.title}, ${variant.sku},
          29900, ${Math.max(variant.mrp, 29900)}, 2, 59800)`;
      const mk = async (type: string, description: string, photos: string[]) => {
        const [row] = await sql<{ id: string }[]>`
          insert into support_cases (order_id, type, description, photo_paths)
          values (${orderId}, ${type}::support_type, ${description}, ${photos}::text[]) returning id`;
        return row!.id;
      };
      cases.refund = await mk("damaged", "The handle arrived cracked in two places.", [
        `support/${stamp}/crack.jpg`,
      ]);
      cases.replacement = await mk("defective", "The clasp does not close.", []);
      cases.reject = await mk("other", "I just don't like the colour.", []);
      const [msg] = await sql<{ id: string }[]>`
        insert into contact_messages (name, email, order_ref, message)
        values ('Asha Rao', ${customerEmail}, ${orderRef}, 'Can I change the delivery address of my order?') returning id`;
      messageId = msg!.id;
    } finally {
      await sql.end();
    }
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

    test("the dashboard's open-cases card leads to the cases tab", async ({ page, isMobile }) => {
      test.skip(isMobile, "desktop only");
      await page.goto("/admin");
      const card = page.getByRole("link", { name: /Open support cases/ });
      await expect(card).toBeVisible();
      await card.click();
      await expect(page).toHaveURL(/\/admin\/support\?tab=cases/);
      await expect(page.getByRole("heading", { name: "Support", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Cases/ })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    test("no serious accessibility violations on the lists, a message, a case and the resolve dialog", async ({
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
      await page.goto("/admin/support");
      await expect(page.getByRole("heading", { name: "Support", exact: true })).toBeVisible();
      await scan("inbox");
      await page.goto("/admin/support?tab=cases");
      await expect(
        shown(page.getByRole("link", { name: cases.refund.slice(0, 8).toUpperCase() })),
      ).toBeVisible();
      await scan("cases");
      await page.goto(`/admin/support/messages/${messageId}`);
      await expect(shown(page.getByText("Can I change the delivery address"))).toBeVisible();
      await scan("message");
      await page.goto(`/admin/support/cases/${cases.refund}`);
      await expect(
        shown(page.getByText("The handle arrived cracked in two places.")),
      ).toBeVisible();
      await scan("case");
      await page.getByRole("button", { name: "Resolve…" }).click();
      await expect(page.getByRole("dialog", { name: /Resolve case/ })).toBeVisible();
      await scan("resolve dialog");
    });

    test("inbox: open a message, reply by e-mail, close it", async ({ page, isMobile }) => {
      test.skip(isMobile, "desktop only");
      await page.goto("/admin/support");
      await page.getByRole("searchbox", { name: "Search messages" }).fill(customerEmail);
      await page.getByRole("button", { name: "Search" }).click();
      await page.getByRole("link", { name: new RegExp(customerEmail) }).click();
      await expect(page).toHaveURL(new RegExp(`/admin/support/messages/${messageId}`));
      await expect(shown(page.getByText("Can I change the delivery address"))).toBeVisible();
      // the typed order reference links to the order, and the e-mail matches it
      await expect(shown(page.getByRole("link", { name: orderRef }))).toBeVisible();
      await expect(shown(page.getByText("Same e-mail as the order"))).toBeVisible();

      await page
        .getByLabel("Reply to the customer by e-mail")
        .fill("Yes, we have updated the address for you.");
      await page.getByRole("button", { name: "Send reply" }).click();
      await expect(shown(page.getByText(`E-mail queued to ${customerEmail}`))).toBeVisible();
      await expect(shown(page.getByText(`Replied to ${customerEmail}`))).toBeVisible();

      await page.getByRole("button", { name: "Close message" }).click();
      await expect(shown(page.getByText("Message closed"))).toBeVisible();
      await expect(page.getByRole("button", { name: "Re-open" })).toBeVisible();
      await expect(
        shown(page.getByText("This message is closed. Re-open it to reply.")),
      ).toBeVisible();
    });

    test("case: pick it up, reply, resolve with a partial refund", async ({ page, isMobile }) => {
      test.skip(isMobile, "desktop only");
      await page.goto("/admin/support?tab=cases");
      await page.getByRole("searchbox", { name: "Search cases" }).fill(orderRef);
      await page.getByRole("button", { name: "Search" }).click();
      await expect(
        page.getByRole("link", { name: cases.refund.slice(0, 8).toUpperCase() }),
      ).toBeVisible();
      await page.getByRole("link", { name: cases.refund.slice(0, 8).toUpperCase() }).click();
      await expect(
        shown(page.getByText("The handle arrived cracked in two places.")),
      ).toBeVisible();
      // the photo lives in the private bucket; with storage unreachable the page says so instead of failing
      await expect(shown(page.getByText("crack.jpg"))).toBeVisible();

      await page.getByRole("button", { name: "Start working on it" }).click();
      await expect(shown(page.getByText(/is in progress/))).toBeVisible();

      await pickOption(page, "Team member", /\(you\)/);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(shown(page.getByText("Assigned", { exact: true }))).toBeVisible();

      await page
        .getByLabel("Reply to the customer by e-mail")
        .fill("So sorry about the crack. We will sort this out today.");
      await page.getByRole("button", { name: "Send reply" }).click();
      await expect(shown(page.getByText(`E-mail queued to ${customerEmail}`))).toBeVisible();

      await page
        .getByLabel("Internal note (staff only)")
        .fill("Photo shows a clean break at the handle.");
      await page.getByRole("button", { name: "Add note" }).click();
      await expect(shown(page.getByText("Note added"))).toBeVisible();

      await page.getByRole("button", { name: "Resolve…" }).click();
      const dialog = page.getByRole("dialog", { name: /Resolve case/ });
      await expect(dialog).toBeVisible();
      // COD: a manual refund needs a UPI / bank reference, and the amount is capped
      await dialog.getByLabel("Refund amount (₹)").fill("99999");
      await expect(dialog.getByText(/At most ₹598 can still be refunded/)).toBeVisible();
      await dialog.getByLabel("Refund amount (₹)").fill("100");
      await expect(dialog.getByRole("button", { name: /Refund ₹100 and resolve/ })).toBeDisabled();
      await dialog.getByLabel("UPI / bank reference").fill("UPI-E2E-1");
      await dialog.getByRole("button", { name: /Refund ₹100 and resolve/ }).click();
      await expect(shown(page.getByText(/resolved\. Refund of ₹100 recorded/))).toBeVisible();

      await expect(shown(page.getByText("Resolved with a refund"))).toBeVisible();
      await expect(shown(page.getByText(/Refunded ₹100/))).toBeVisible();
      await expect(page.getByRole("button", { name: "Resolve…" })).toHaveCount(0);
      await expect(shown(page.getByText("This case is closed."))).toBeVisible();

      // the refund is on the order
      await shown(page.getByRole("link", { name: orderRef, exact: true })).click();
      await expect(page).toHaveURL(new RegExp(`/admin/orders/${orderId}`));
      await expect(shown(page.getByText(/ref UPI-E2E-1/))).toBeVisible();
      await expect(page.getByText(/Support case/).first()).toBeVisible();
    });

    test("case: resolve with a replacement order", async ({ page, isMobile }) => {
      test.skip(isMobile, "desktop only");
      await page.goto(`/admin/support/cases/${cases.replacement}`);
      await page.getByRole("button", { name: "Resolve…" }).click();
      const dialog = page.getByRole("dialog", { name: /Resolve case/ });
      await pickOption(page, "Outcome", /Replacement/, dialog);
      await expect(dialog.getByRole("button", { name: "Resolve case" })).toBeDisabled();
      await dialog.locator('input[id^="rep-"]').first().fill("1");
      await dialog.getByRole("button", { name: "Resolve case" }).click();
      await expect(
        shown(page.getByText(/Replacement order IFO-\d{4}-[0-9A-Z]{4} created/)),
      ).toBeVisible();

      const link = page
        .getByRole("link", { name: /^IFO-\d{4}-[0-9A-Z]{4}$/ })
        .filter({ hasNotText: orderRef });
      await expect(link.first()).toBeVisible();
      await link.first().click();
      // the free order is confirmed, ₹0, and says what it replaces
      await expect(page.getByText("Confirmed").first()).toBeVisible();
      await expect(shown(page.getByText(`Replacement for order ${orderRef}`))).toBeVisible();
    });

    test("case: reject with a message for the customer", async ({ page, isMobile }) => {
      test.skip(isMobile, "desktop only");
      await page.goto(`/admin/support/cases/${cases.reject}`);
      await page.getByRole("button", { name: "Reject…" }).click();
      const dialog = page.getByRole("dialog", { name: /Reject case/ });
      await expect(dialog.getByRole("button", { name: "Reject case" })).toBeDisabled();
      await dialog
        .getByLabel("Message to the customer")
        .fill(
          "Thanks for telling us. A colour preference isn't covered, but we're happy to help with an exchange.",
        );
      await dialog.getByRole("button", { name: "Reject case" }).click();
      await expect(shown(page.getByText(/rejected\. The customer was e-mailed/))).toBeVisible();
      await expect(shown(page.getByText("This case is closed."))).toBeVisible();

      // the list now shows nothing needing attention for this order
      await page.goto("/admin/support?tab=cases");
      await page.getByRole("searchbox", { name: "Search cases" }).fill(orderRef);
      await page.getByRole("button", { name: "Search" }).click();
      await expect(shown(page.getByText("No cases match these filters."))).toBeVisible();
      await pickOption(page, "Status", "All");
      await expect(
        page.getByRole("link", { name: cases.reject.slice(0, 8).toUpperCase() }),
      ).toBeVisible();
    });
  });
});
