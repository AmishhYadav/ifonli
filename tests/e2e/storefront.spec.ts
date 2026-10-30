import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Storefront e2e (home, collections, search, header). Run against a production build:
 *   NEXT_DIST_DIR=.next-shop pnpm exec next build && NEXT_DIST_DIR=.next-shop pnpm exec next start -p 3103
 *   E2E_BASE_URL=http://localhost:3103 pnpm exec playwright test storefront
 * Needs the dev database with the placeholder product seed (32 products).
 */

const ORDER = ["cute", "bold", "overthinking", "gothic", "funky"] as const;

const htmlVibe = (page: Page) => page.locator("html").getAttribute("data-vibe");
const cards = (page: Page) => page.locator('[data-testid="product-card"]:visible');

/** Product names of the visible cards (hidden vibe sets are display: none). */
async function visibleNames(page: Page, scope: string): Promise<string[]> {
  return page.locator(`${scope} [data-testid="product-card"]:visible h3`).allTextContents();
}

async function prices(page: Page): Promise<number[]> {
  const texts = await page
    .locator('[data-testid="product-grid"] [data-testid="product-card"]')
    .evaluateAll((els) =>
      els.map((el) => el.querySelector("span.tabular-nums")?.textContent ?? ""),
    );
  return texts.map((t) => Number(t.replace(/[^\d]/g, "")));
}

test.describe("home", () => {
  test("renders the poster hero with a visible Shop button and featured products", async ({ page }) => {
    await page.goto("/?vibe=cute");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("hero-shop")).toBeVisible();
    await expect(page.getByTestId("hero-shop")).toHaveAttribute("href", "/shop");
    // Poster: tiles of the active vibe only; every vibe's set is in the DOM.
    await expect(page.locator('[data-testid^="hero-tiles-cute-"]:visible')).toHaveCount(2);
    expect(await page.locator('[data-testid^="hero-tiles-"]').count()).toBe(10);
    // Featured: 8 cards visible out of 5 x 8 in the DOM.
    const featured = page.locator('section[aria-label="Featured products"]');
    await expect(featured.locator('[data-testid="product-card"]:visible')).toHaveCount(8);
    expect(await featured.locator('[data-testid="product-card"]').count()).toBe(40);
    // Five vibe cards, each in its own scope.
    for (const v of ORDER) {
      await expect(page.locator(`#vibes article[data-vibe="${v}"]`)).toBeVisible();
    }
  });

  test("the hand button swaps hero copy and featured products with no content requests", async ({ page }) => {
    await page.goto("/?vibe=cute");
    const featured = 'section[aria-label="Featured products"]';
    await expect(page.locator(`${featured} [data-testid="product-card"]:visible`)).toHaveCount(8);
    const before = await visibleNames(page, featured);
    const headlineBefore = await page.getByRole("heading", { level: 1 }).innerText();

    const contentRequests: string[] = [];
    page.on("request", (request) => {
      // Link prefetches (`next-router-prefetch`) are viewport-driven, not content for the switch; `__nextjs_*`
      // are dev-overlay requests.
      const headers = request.headers();
      const prefetch = "next-router-prefetch" in headers || "next-router-segment-prefetch" in headers;
      if (
        ["document", "fetch", "xhr"].includes(request.resourceType()) &&
        !prefetch &&
        !request.url().includes("__nextjs_")
      ) {
        contentRequests.push(`${request.resourceType()} ${request.url()}`);
      }
    });

    await page.locator("button[data-vibe-hand]").first().click();
    await expect.poll(() => htmlVibe(page)).toBe("bold");
    await page.waitForTimeout(500);

    const after = await visibleNames(page, featured);
    expect(after).toHaveLength(8);
    expect(after).not.toEqual(before);
    expect(await page.getByRole("heading", { level: 1 }).innerText()).not.toBe(headlineBefore);
    expect(contentRequests).toEqual([]);
  });
});

test.describe("collections", () => {
  test("/shop lists every product with facet counts, filters and sorts via the URL", async ({ page }) => {
    await page.goto("/shop");
    await expect(page.getByTestId("result-count")).toHaveText("32 products");
    // First page is 24 products, with a Load more link to the next page.
    await expect(page.getByTestId("product-grid").getByTestId("product-card")).toHaveCount(24);
    await expect(page.getByRole("link", { name: "Load more" })).toHaveAttribute("href", /page=2/);

    await page.goto("/shop?types=charms&sort=price_asc&vibe=cute");
    await expect(page.getByTestId("result-count")).toHaveText("10 products");
    const asc = await prices(page);
    expect(asc).toHaveLength(10);
    expect([...asc].sort((a, b) => a - b)).toEqual(asc);

    await page.goto("/shop?types=charms&sort=price_desc");
    const desc = await prices(page);
    expect([...desc].sort((a, b) => b - a)).toEqual(desc);

    await page.goto("/shop?min=200&max=300");
    const ranged = await prices(page);
    expect(ranged.length).toBeGreaterThan(0);
    for (const price of ranged) {
      expect(price).toBeGreaterThanOrEqual(200);
      expect(price).toBeLessThanOrEqual(300);
    }

    // Unknown filter values are ignored, not an error.
    await page.goto("/shop?types=nope&vibes=nope&sort=nope");
    await expect(page.getByTestId("result-count")).toHaveText("32 products");
  });

  test("the filter form updates the URL", async ({ page, isMobile }) => {
    await page.goto("/shop");
    if (isMobile) {
      await page.getByRole("button", { name: /^Filters/ }).click();
      const drawer = page.getByRole("dialog", { name: "Filters" });
      await drawer.getByRole("checkbox", { name: /Hippers/ }).check();
      await expect(page).toHaveURL(/types=hippers/);
      await drawer.getByRole("button", { name: /Show \d+ products/ }).click();
    } else {
      await page.getByRole("complementary", { name: "Filters" }).getByRole("checkbox", { name: /Hippers/ }).check();
      await expect(page).toHaveURL(/types=hippers/);
    }
    await expect(page.getByTestId("result-count")).toHaveText("6 products");
    // The chip removes the filter again.
    await page.getByRole("link", { name: "Remove filter: Hippers" }).click();
    await expect(page.getByTestId("result-count")).toHaveText("32 products");
  });

  test('"Wear this vibe" on a vibe page switches the whole site', async ({ page }) => {
    await page.goto("/vibes/gothic?vibe=cute");
    await expect(page.getByRole("heading", { level: 1, name: "Gothic" })).toBeVisible();
    // The header band is scoped to Gothic while the site stays Cute.
    await expect(page.locator('section[aria-label="Gothic vibe"]')).toHaveAttribute("data-vibe", "gothic");
    expect(await htmlVibe(page)).toBe("cute");
    await page.getByTestId("wear-vibe").click();
    await expect.poll(() => htmlVibe(page)).toBe("gothic");
    await expect(page.getByTestId("wear-vibe")).toHaveText(/You're wearing Gothic/);
    // Vibe pages list only that vibe's products.
    await expect(page.getByTestId("result-count")).toHaveText("10 products");
  });

  test("an unknown vibe or type renders the themed 404", async ({ page }) => {
    await page.goto("/vibes/nope?vibe=gothic");
    await expect(page.getByRole("heading", { level: 1, name: "Lost in the fog" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    await page.goto("/types/nope?vibe=cute");
    await expect(page.getByRole("heading", { level: 1, name: "Oopsie, wrong turn!" })).toBeVisible();
    // A route that does not exist at all answers a real 404.
    const response = await page.goto("/no-such-page");
    expect(response?.status()).toBe(404);
  });

  test("the theme never removes products", async ({ page }) => {
    const counts: string[] = [];
    for (const vibe of ["cute", "gothic"] as const) {
      await page.goto(`/shop?vibe=${vibe}`);
      expect(await htmlVibe(page)).toBe(vibe);
      await expect(cards(page)).toHaveCount(24);
      counts.push(
        `${await page.getByTestId("result-count").innerText()}/${await cards(page).count()}`,
      );
    }
    expect(counts[0]).toBe(counts[1]);
    expect(counts[0]).toBe("32 products/24");
  });
});

test.describe("search", () => {
  test("finds skull and the typo skul", async ({ page }) => {
    for (const q of ["skull", "skul"]) {
      await page.goto(`/search?q=${q}`);
      await expect(page.getByRole("link", { name: /Skull charm/ }).first()).toBeVisible();
    }
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("shows themed no-results with ways forward", async ({ page }) => {
    await page.goto("/search?q=zzzzqqqq&vibe=gothic");
    await expect(page.getByRole("heading", { level: 2, name: "The void returns nothing" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Cute" }).first()).toBeVisible();
    await expect(page.locator('[data-testid="search-empty"] [data-testid="product-card"]:visible')).toHaveCount(4);
  });

  test("the header sheet shows quick results and Enter goes to /search", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Search" }).click();
    const input = page.getByRole("searchbox", { name: "Search products" });
    await expect(input).toBeFocused();
    await input.fill("skul");
    await expect(page.getByRole("list", { name: "Quick results" }).getByText("Skull charm")).toBeVisible();
    await input.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=skul/);
  });
});

test.describe("header", () => {
  test("keyboard: skip link, hand button, then the Vibes menu opens, moves and closes", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop navigation");
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("button[data-vibe-hand]").first()).toBeFocused();
    await page.keyboard.press("Tab"); // logo
    await page.keyboard.press("Tab"); // Shop
    await page.keyboard.press("Tab"); // Vibes
    const vibes = page.getByRole("button", { name: "Vibes" });
    await expect(vibes).toBeFocused();
    await expect(vibes).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(vibes).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("link", { name: "Cute" }).first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("link", { name: "Bold" }).first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(vibes).toHaveAttribute("aria-expanded", "false");
    await expect(vibes).toBeFocused();
  });

  test("the hand button is top-left and keyboard-operable", async ({ page }) => {
    await page.goto("/?vibe=cute");
    const hand = page.locator("button[data-vibe-hand]").first();
    const box = await hand.boundingBox();
    expect(box?.x ?? 99).toBeLessThan(40);
    await hand.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => htmlVibe(page)).toBe("bold");
    await page.keyboard.press("Space");
    await expect.poll(() => htmlVibe(page)).toBe("overthinking");
  });

  test("mobile: the menu opens in a drawer with vibe links", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile navigation");
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Menu" });
    await expect(drawer.getByRole("link", { name: /Gothic/ })).toBeVisible();
    await drawer.getByRole("link", { name: /Gothic/ }).click();
    await expect(page).toHaveURL(/\/vibes\/gothic/);
  });
});

test.describe("accessibility (axe: no serious or critical violations)", () => {
  for (const vibe of ORDER) {
    for (const path of ["/", "/shop", "/vibes/gothic", "/search?q=skull"]) {
      test(`${path} in ${vibe}`, async ({ page }) => {
        await page.goto(`${path}${path.includes("?") ? "&" : "?"}vibe=${vibe}`);
        expect(await htmlVibe(page)).toBe(vibe);
        await page.waitForLoadState("networkidle");
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
        const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(
          bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`),
        ).toEqual([]);
      });
    }
  }
});
