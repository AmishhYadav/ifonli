import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Policies and help e2e. Run against a production build made with the dev pages on (so a policy that still
 * has an unfilled setting renders with highlighted markers instead of being withheld):
 *   NEXT_PUBLIC_ENABLE_DEV_PAGES=1 NEXT_DIST_DIR=.next-shop pnpm exec next build
 *   NEXT_DIST_DIR=.next-shop pnpm exec next start -p 3103
 *   E2E_BASE_URL=http://localhost:3103 pnpm exec playwright test content
 * Needs the dev database seeded with `pnpm db:seed` and `scripts/seed-content.ts` (see content/README.md).
 */

const POLICIES = [
  "shipping",
  "cancellation",
  "returns-refunds",
  "privacy",
  "terms",
  "seller-information",
] as const;

const seriousViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
};

test.describe("policies", () => {
  for (const slug of POLICIES) {
    test(`/policies/${slug} renders with its title, version and contents`, async ({ page }) => {
      // admin-content.spec publishes and edits the shipping policy, possibly while this runs in another worker.
      test.skip(
        slug === "shipping" && !!process.env.E2E_ADMIN_FLOW,
        "shipping is changed by admin-content.spec when E2E_ADMIN_FLOW is set",
      );
      const response = await page.goto(`/policies/${slug}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByTestId("policy-meta")).toContainText("Version 1");
      await expect(page.locator("article h2").first()).toBeVisible();
      // Exactly one H1 (the body's own title heading is dropped).
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    });
  }

  test("the index lists every policy and each link resolves", async ({ page }) => {
    await page.goto("/policies");
    const links = page.locator('main a[href^="/policies/"]');
    await expect(links).toHaveCount(POLICIES.length);
    for (const slug of POLICIES) {
      await expect(page.locator(`main a[href="/policies/${slug}"]`)).toBeVisible();
    }
  });

  test("an unknown policy is a themed 404 page", async ({ page }) => {
    await page.goto("/policies/not-a-policy");
    await expect(page.getByText("404", { exact: true })).toBeVisible();
    await expect(page.getByRole("search")).toBeVisible();
    await expect(page.locator("main").getByText("DRAFT")).toHaveCount(0);
  });

  test("a long policy has a contents list that jumps to its sections", async ({ page, isMobile }) => {
    await page.goto("/policies/terms");
    if (isMobile) await page.locator("summary", { hasText: "On this page" }).click();
    const toc = page.getByRole("navigation", { name: isMobile ? "On this page" : "Contents" });
    const first = toc.getByRole("link").first();
    await expect(first).toBeVisible();
    const id = ((await first.getAttribute("href")) as string).slice(1);
    await first.click();
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    await expect(page.locator(`[id="${id}"]`)).toBeInViewport();
  });
});

test.describe("footer, cart, checkout and PDP links", () => {
  test("every internal footer link resolves (no 404s)", async ({ page, request }) => {
    // ~20 footer routes, several of them (vibe and type pages) not yet compiled when this runs under `next dev`.
    test.setTimeout(120_000);
    await page.goto("/policies/shipping");
    const hrefs = await page
      .locator("footer a[href^='/']")
      .evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLAnchorElement).getAttribute("href") as string))]);
    expect(hrefs).toEqual(expect.arrayContaining(["/help", "/track", ...POLICIES.map((s) => `/policies/${s}`)]));
    for (const href of hrefs) {
      const res = await request.get(href);
      expect(res.status(), href).toBeLessThan(400);
    }
  });

  test("policy, help and track links used by the cart and checkout resolve", async ({ request }) => {
    for (const href of ["/policies/returns-refunds", "/policies/terms", "/policies/privacy", "/policies/shipping", "/help", "/track"]) {
      expect((await request.get(href)).status(), href).toBe(200);
    }
  });
});

test.describe("help page", () => {
  test("shows support details, FAQ groups and links", async ({ page }) => {
    await page.goto("/help");
    await expect(page.getByRole("heading", { level: 1, name: "Help and contact" })).toBeVisible();
    for (const category of ["delivery", "payment", "orders"]) {
      await expect(page.getByTestId(`faq-${category}`)).toBeVisible();
    }
    await expect(page.getByRole("link", { name: /Track your order/ }).first()).toHaveAttribute("href", "/track");
    await expect(page.getByRole("link", { name: "All policies" })).toHaveAttribute("href", "/policies");
  });

  test("the FAQ accordion works from the keyboard", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard interaction is checked on desktop");
    await page.goto("/help");
    const triggers = page.getByTestId("faq-delivery").getByRole("button");
    const first = triggers.nth(0);
    const second = triggers.nth(1);
    await first.focus();
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("faq-delivery").getByRole("region").first()).toBeVisible();
    await page.keyboard.press("Space");
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("ArrowDown");
    await expect(second).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(second).toHaveAttribute("aria-expanded", "true");
    // Opening another one closes the first (single mode).
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await expect(second).toHaveAttribute("aria-expanded", "false");
  });

  test("the contact form validates, then confirms a sent message", async ({ page }, info) => {
    // Unique client address and e-mail so the rate limits never trip on repeated local runs.
    const n = Math.floor(Math.random() * 250) + 1;
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${n}, 10.0.0.1` });
    await page.goto("/help");
    const form = page.getByTestId("contact-form");
    await form.getByRole("button", { name: "Send message" }).click();
    await expect(form.getByText("Enter your name")).toBeVisible();
    await expect(form.getByText("Enter your email address")).toBeVisible();
    await expect(form.getByText(/Write at least 10 characters/)).toBeVisible();
    await expect(form.getByLabel(/Your name/)).toBeFocused();

    await form.getByLabel(/Your name/).fill("E2E Tester");
    await form.getByLabel(/^Email/).fill("not-an-email");
    await form.getByLabel(/Mobile number/).fill("12345");
    await form.getByLabel(/How can we help/).fill("too short");
    await form.getByRole("button", { name: "Send message" }).click();
    await expect(form.getByText("Enter a valid email address, like name@example.com")).toBeVisible();
    await expect(form.getByText(/10-digit Indian mobile/)).toBeVisible();
    // Typed text survives a failed submit.
    await expect(form.getByLabel(/Your name/)).toHaveValue("E2E Tester");

    await form.getByLabel(/^Email/).fill(`e2e-${info.project.name}-${Date.now()}@example.invalid`);
    await form.getByLabel(/Mobile number/).fill("98765 43210");
    await form.getByLabel(/How can we help/).fill("Automated test message, please ignore this one.");
    await form.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByTestId("contact-sent")).toContainText("Message sent");
    await page.getByRole("button", { name: "Send another message" }).click();
    await expect(page.getByTestId("contact-form")).toBeVisible();
    await expect(page.getByLabel(/Your name/)).toHaveValue("");
  });
});

test.describe("accessibility", () => {
  for (const vibe of ["gothic", "funky"] as const) {
    for (const path of ["/policies/shipping", "/policies", "/help"]) {
      test(`${path} has no serious or critical axe violations in ${vibe}`, async ({ page }) => {
        await page.goto(`${path}?vibe=${vibe}`);
        await expect(page.locator("html")).toHaveAttribute("data-vibe", vibe);
        await page.waitForLoadState("networkidle");
        if (path === "/help") await page.getByTestId("faq-delivery").getByRole("button").first().click();
        expect(await seriousViolations(page)).toEqual([]);
      });
    }
  }
});
