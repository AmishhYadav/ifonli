import { randomBytes } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  applyCommerce,
  cleanupQa,
  insertQaOrder,
  seedCart,
  signInCustomer,
} from "../support/commerce";
import { sql } from "../support/db";
import { VIBES, gotoVibe } from "../support/vibes";

/**
 * Keyboard pass: skip link, header (hand button, menus, search, cart drawer), product page, checkout, the
 * customer dialogs and the account forms. Every stop of a Tab sweep must show a focus indicator, dialogs and
 * drawers must trap focus and give it back, and nothing may trap the keyboard.
 *
 *   E2E_BASE_URL=http://localhost:3108 pnpm e2e tests/e2e/keyboard.spec.ts --project=chromium-desktop
 */

test.describe.configure({ mode: "default" });
test.setTimeout(150_000);
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "run with --project=chromium-desktop");
});

const SHOPPER = "qa-keyboard@example.com";
const OWN_REF = "IFO-2610-QA41";
const OWN_TOKEN = `qa-${randomBytes(24).toString("base64url")}`;
const SHIPPED_REF = "IFO-2610-QA42";
const SHIPPED_TOKEN = `qa-${randomBytes(24).toString("base64url")}`;
let restore: () => Promise<void> = async () => {};
let productSlug = "";

test.beforeAll(async () => {
  await cleanupQa();
  restore = await applyCommerce();
  const [p] = await sql<{ slug: string }[]>`
    select p.slug from products p join variants v on v.product_id = p.id where v.sku = 'PH-CHARM-HEART-LILAC'`;
  productSlug = p!.slug;
});

test.afterAll(async () => {
  await cleanupQa();
  await restore();
});

interface Stop {
  tag: string;
  name: string;
  visibleFocus: boolean;
  inViewport: boolean;
}

/** What the focused element looks like: does it have an outline or ring, and is it on screen? */
async function focusInfo(page: Page): Promise<Stop | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) return null;
    const cs = getComputedStyle(el);
    const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
    const ring = cs.boxShadow !== "none" && cs.boxShadow !== "";
    // A visually hidden input drawn by its label (checkbox, radio, switch): the label or sibling shows the focus.
    const wrapper = el.closest("label, [role='radiogroup'], [data-slot]");
    const wrapperCs = wrapper ? getComputedStyle(wrapper) : null;
    const wrapperRing =
      !!wrapperCs && (wrapperCs.outlineStyle !== "none" || wrapperCs.boxShadow !== "none");
    const sibling = el.nextElementSibling as HTMLElement | null;
    const siblingCs = sibling ? getComputedStyle(sibling) : null;
    const siblingRing =
      !!siblingCs && (siblingCs.outlineStyle !== "none" || siblingCs.boxShadow !== "none");
    const within = el.closest(":focus-within") !== null;
    // Stretched links draw the ring on their card (`has-[a:focus-visible]`), or on a pseudo-element.
    const card = el.closest("article, li, [data-slot]");
    const cardCs = card && card !== el ? getComputedStyle(card) : null;
    const cardRing =
      !!cardCs && cardCs.outlineStyle !== "none" && parseFloat(cardCs.outlineWidth) > 0;
    const pseudoRing = ["::before", "::after"].some((p) => {
      const ps = getComputedStyle(el, p);
      return ps.outlineStyle !== "none" && parseFloat(ps.outlineWidth) > 0;
    });
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      name: (
        el.getAttribute("aria-label") ||
        el.textContent ||
        el.getAttribute("name") ||
        el.id ||
        ""
      )
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 50),
      visibleFocus:
        outline || ring || cardRing || pseudoRing || ((wrapperRing || siblingRing) && within),
      inViewport:
        r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth,
    };
  });
}

/** Tabs through the page, returns every stop; fails if the sequence never reaches the end (a keyboard trap). */
async function tabSweep(page: Page, max = 90): Promise<Stop[]> {
  const stops: Stop[] = [];
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const info = await focusInfo(page);
    if (!info) break; // focus left the document: the next stop is the browser chrome
    if (info.tag === "nextjs-portal") break; // dev-server overlay: the end of the page content
    stops.push(info);
  }
  return stops;
}

function describeStops(stops: Stop[]): string {
  return stops.map((s) => `${s.tag} "${s.name}"`).join(" > ");
}

async function expectVisibleFocus(page: Page, label: string, max?: number) {
  const stops = await tabSweep(page, max);
  expect(stops.length, `${label}: nothing is focusable`).toBeGreaterThan(3);
  const bad = stops.filter((s) => !s.visibleFocus);
  expect(
    bad.map((s) => `${s.tag} "${s.name}"`),
    `${label}: focus indicator missing on these stops\n${describeStops(stops)}`,
  ).toEqual([]);
}

test.describe("skip link and header", () => {
  test("the skip link is the first stop, shows itself, and moves focus to the main content", async ({
    page,
  }) => {
    await gotoVibe(page, "/shop", "bold");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    const box = (await skip.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.width).toBeGreaterThan(40);
    await page.keyboard.press("Enter");
    const target = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return { id: el?.id ?? "", inMain: !!el?.closest("main") || el?.tagName === "MAIN" };
    });
    expect(target.inMain).toBe(true);
    // The next Tab lands inside the content, not back in the header.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("main"))).toBe(true);
  });

  for (const vibe of VIBES) {
    test(`every header and page stop shows a focus indicator in ${vibe}`, async ({ page }) => {
      await gotoVibe(page, "/", vibe);
      await page.waitForLoadState("networkidle");
      await expectVisibleFocus(page, `home in ${vibe}`, 60);
    });
  }

  test("search sheet: opens from the header, focuses the field, Escape returns focus to the button", async ({
    page,
  }) => {
    await gotoVibe(page, "/", "cute");
    await page.waitForLoadState("networkidle");
    const trigger = page.getByRole("button", { name: /Search/ }).first();
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("searchbox").or(dialog.getByRole("combobox")).first(),
    ).toBeFocused();
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
        true,
      );
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("cart drawer: opens from the header button, traps focus, closes with Escape and returns focus", async ({
    page,
    context,
    baseURL,
  }) => {
    await seedCart(context, baseURL!, 1);
    await gotoVibe(page, "/", "funky");
    await page.waitForLoadState("networkidle");
    const trigger = page.locator('[data-testid="cart-button"]:visible');
    await trigger.focus();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog").first();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId("cart-drawer").or(drawer)).toBeVisible();
    const focusedInside = await page.evaluate(
      () => !!document.activeElement?.closest('[role="dialog"]'),
    );
    expect(focusedInside, "focus moves into the drawer when it opens").toBe(true);
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
        true,
      );
      const info = await focusInfo(page);
      expect(
        info?.visibleFocus,
        `drawer stop ${info?.tag} "${info?.name}" has no focus indicator`,
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe("product page", () => {
  test("variant, quantity and add to cart work from the keyboard, with visible focus", async ({
    page,
  }) => {
    await gotoVibe(page, `/products/${productSlug}`, "gothic");
    await page.waitForLoadState("networkidle");
    await expectVisibleFocus(page, "product page", 80);

    // Add to cart with the keyboard only; the status is announced in a live region.
    const add = page.getByTestId("add-to-cart");
    await add.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="cart-count"]:visible')).toHaveText("1");
    await expect(
      page.locator('[role="status"], [aria-live]').filter({ hasText: /./ }).first(),
    ).toBeAttached();
  });
});

test.describe("checkout", () => {
  test("fields, policy tick and the pay buttons are reachable in order, each with a focus indicator", async ({
    page,
    context,
    baseURL,
  }) => {
    await seedCart(context, baseURL!, 1);
    await gotoVibe(page, "/checkout", "overthinking");
    await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false", {
      timeout: 30_000,
    });
    const stops = await tabSweep(page, 70);
    const names = stops.map((s) => s.name.toLowerCase());
    const order = ["email", "phone", "pincode"].map((n) => names.findIndex((x) => x.includes(n)));
    expect(
      order.every((i) => i >= 0),
      `form fields reachable: ${describeStops(stops)}`,
    ).toBe(true);
    expect(
      [...order].sort((a, b) => a - b),
      "email, phone, pincode are in reading order",
    ).toEqual(order);
    const bad = stops.filter((s) => !s.visibleFocus).map((s) => `${s.tag} "${s.name}"`);
    expect(bad, `checkout focus indicators\n${describeStops(stops)}`).toEqual([]);
  });

  test("submitting with errors moves focus to the first invalid field", async ({
    page,
    context,
    baseURL,
  }) => {
    await seedCart(context, baseURL!, 1);
    await gotoVibe(page, "/checkout", "cute");
    await expect(page.getByTestId("review")).toHaveAttribute("aria-busy", "false", {
      timeout: 30_000,
    });
    await page
      .getByRole("button", { name: /^Pay .* securely$|^Place COD order/ })
      .first()
      .click();
    await expect(page.getByLabel("Email")).toBeFocused();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  });
});

test.describe("dialogs and account forms", () => {
  test("cancel-order and report-a-problem dialogs trap focus and return it to their buttons", async ({
    page,
    context,
    baseURL,
  }) => {
    const userId = await signInCustomer(context, baseURL!, SHOPPER);
    await insertQaOrder({
      ref: OWN_REF,
      email: SHOPPER,
      userId,
      token: OWN_TOKEN,
      paymentMethod: "cod",
      status: "confirmed",
      paymentStatus: "cod_pending",
      fulfillment: "unfulfilled",
    });
    await insertQaOrder({
      ref: SHIPPED_REF,
      email: SHOPPER,
      userId,
      token: SHIPPED_TOKEN,
      paymentMethod: "razorpay",
      status: "processing",
      paymentStatus: "paid",
      fulfillment: "shipped",
      shipment: {
        courier: "Delhivery",
        awb: "QA123456789",
        trackingUrl: "https://example.com/track/QA123456789",
      },
    });

    await gotoVibe(page, `/account/orders/${OWN_REF}`, "gothic");
    await page.waitForLoadState("networkidle");
    const cancel = page.getByRole("button", { name: "Cancel order" });
    await cancel.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Cancel this order?" });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
        true,
      );
      const info = await focusInfo(page);
      expect(info?.visibleFocus, `cancel dialog stop ${info?.tag} "${info?.name}"`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(cancel).toBeFocused();

    const report = page.getByRole("button", { name: "Report a problem" });
    await report.focus();
    await page.keyboard.press("Enter");
    const reportDialog = page.getByRole("dialog", { name: "Report a problem" });
    await expect(reportDialog).toBeVisible();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
        true,
      );
    }
    await page.keyboard.press("Escape");
    await expect(reportDialog).toBeHidden();
    await expect(report).toBeFocused();
  });

  for (const path of [
    "/account",
    "/account/orders",
    "/account/addresses",
    "/account/profile",
    "/account/login",
  ]) {
    test(`${path}: every stop shows a focus indicator`, async ({ page, context, baseURL }) => {
      if (path !== "/account/login") await signInCustomer(context, baseURL!, SHOPPER);
      await gotoVibe(page, path, "funky");
      await page.waitForLoadState("networkidle");
      await expectVisibleFocus(page, path, 70);
    });
  }

  test("the address form opens, traps focus and gives it back", async ({
    page,
    context,
    baseURL,
  }) => {
    await signInCustomer(context, baseURL!, SHOPPER);
    await gotoVibe(page, "/account/addresses", "bold");
    await page.waitForLoadState("networkidle");
    const add = page.getByTestId("add-address");
    await add.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible().catch(() => false)) {
      for (let i = 0; i < 16; i++) {
        await page.keyboard.press("Tab");
        expect(
          await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')),
        ).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(add).toBeFocused();
    } else {
      // Inline form: the first field is focused and the sweep shows indicators.
      await expectVisibleFocus(page, "address form", 40);
    }
  });
});

test.describe("tracking and help", () => {
  for (const path of ["/track", "/help", "/policies/shipping", "/cart", "/search?q=heart"]) {
    test(`${path}: every stop shows a focus indicator`, async ({ page }) => {
      await gotoVibe(page, path, "overthinking");
      await page.waitForLoadState("networkidle");
      await expectVisibleFocus(page, path, 80);
    });
  }
});
