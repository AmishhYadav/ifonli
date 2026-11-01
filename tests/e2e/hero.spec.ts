import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Animated hero (FR-21, plan section 9). Runs against a dev server or a build made with
 * NEXT_PUBLIC_ENABLE_DEV_PAGES=1 (the test hook `window.__ifonliHero` and /dev/hero exist only then):
 *   NEXT_PUBLIC_ENABLE_DEV_PAGES=1 pnpm dev -p 3105
 *   E2E_BASE_URL=http://localhost:3105 pnpm exec playwright test hero --project chromium-desktop
 */

const VIBES = ["cute", "funky", "bold", "gothic"] as const;
const STAGE_MARKER = "ifonli-hero-stage-chunk-v1";

interface HeroState {
  t: number;
  scene: number;
  profile: string;
  pending: string | null;
  pendingBoundary: number | null;
  paused: string[];
  tileCount: number;
  ready: boolean;
}
interface HeroHook {
  ready: boolean;
  seek(t: number): void;
  pause(): void;
  play(): void;
  state(): HeroState;
}
interface HeroWindow {
  __ifonliHero?: HeroHook;
  __heroEvents: { name: string; props: Record<string, unknown> }[];
}

const state = (page: Page) =>
  page.evaluate(() => (window as unknown as HeroWindow).__ifonliHero!.state());
const seek = (page: Page, t: number) =>
  page.evaluate((time) => (window as unknown as HeroWindow).__ifonliHero!.seek(time), t);

async function openHero(page: Page, vibe: (typeof VIBES)[number] = "cute") {
  await page.goto(`/home?vibe=${vibe}`);
  await page.waitForFunction(
    () => (window as unknown as HeroWindow).__ifonliHero?.ready === true,
    null,
    {
      timeout: 45_000,
    },
  );
  // The hero is at the top of the page: wait for the visibility observer to report it, so tests start "watched".
  await page.waitForFunction(
    () => !(window as unknown as HeroWindow).__ifonliHero!.state().paused.includes("offscreen"),
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as HeroWindow;
    w.__heroEvents = [];
    window.addEventListener("ifonli:analytics", (e) => {
      const { name, props } = (e as CustomEvent<{ name: string; props: Record<string, unknown> }>)
        .detail;
      w.__heroEvents.push({ name, props });
    });
  });
});

/** Bodies of every script the page loaded, to look for the lazily loaded stage chunk. */
function watchScripts(page: Page) {
  const bodies: Promise<string>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script") {
      bodies.push(response.text().catch(() => ""));
    }
  });
  return async () =>
    (await Promise.all(bodies)).filter((text) => text.includes(STAGE_MARKER)).length;
}

test.describe("progressive enhancement", () => {
  test("loads the animation after idle on a normal connection, and the poster is server-rendered", async ({
    page,
  }) => {
    const stageChunks = watchScripts(page);
    const response = await page.goto("/home?vibe=cute");
    // The poster (LCP) is in the HTML itself.
    const html = await response!.text();
    expect(html).toContain("data-hero");
    expect(html).toContain("data-poster-i");
    expect(html).toContain('data-testid="hero-shop"');
    await page.waitForFunction(
      () => (window as unknown as HeroWindow).__ifonliHero?.ready === true,
      null,
      {
        timeout: 45_000,
      },
    );
    expect(await stageChunks()).toBeGreaterThan(0);
    await expect(page.locator("[data-hero-stage-inner]")).toHaveCount(1);
  });

  test("adds no layout shift: the hero box is identical with and without the stage", async ({
    browser,
    baseURL,
  }) => {
    const rect = async (reducedMotion: "reduce" | "no-preference") => {
      const context = await browser.newContext({ reducedMotion, baseURL });
      const page = await context.newPage();
      await page.addInitScript(() => {
        (window as unknown as { __cls: number }).__cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as {
            value: number;
            hadRecentInput: boolean;
          }[]) {
            if (!entry.hadRecentInput)
              (window as unknown as { __cls: number }).__cls += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      if (reducedMotion === "reduce") {
        await page.goto("/home?vibe=cute");
        await expect(page.getByTestId("hero-shop")).toBeVisible();
      } else {
        await openHero(page);
      }
      await page.waitForTimeout(1200);
      const box = await page.locator("[data-hero]").boundingBox();
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      await context.close();
      return { box, cls };
    };
    const poster = await rect("reduce");
    const animated = await rect("no-preference");
    expect(animated.box).toEqual(poster.box);
    expect(animated.cls).toBeLessThan(0.05); // plan section 13 budget
  });

  test("keeps at most 60 tiles in the DOM", async ({ page }) => {
    await openHero(page);
    const count = await page.locator("[data-stage-tile]").count();
    expect(count).toBeGreaterThan(8);
    expect(count).toBeLessThanOrEqual(60);
    expect((await state(page)).tileCount).toBe(count);
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("shows the poster only: no stage, no hook, no animation script", async ({ page }) => {
      const stageChunks = watchScripts(page);
      await page.goto("/home?vibe=bold");
      await expect(page.getByTestId("hero-shop")).toBeVisible();
      await expect(page.locator("[data-hero] [data-poster-list]:visible").first()).toBeVisible();
      await page.waitForTimeout(3500); // well past the idle + visibility checks
      await expect(page.locator("[data-hero-stage-inner]")).toHaveCount(0);
      expect(
        await page.evaluate(() => (window as unknown as HeroWindow).__ifonliHero),
      ).toBeUndefined();
      expect(await stageChunks()).toBe(0);
      await expect(page.locator("[data-stage-toggle]")).toHaveCount(0);
    });

    test("poster tile clicks still report hero_tile_click (animated: false)", async ({ page }) => {
      await page.goto("/home?vibe=bold");
      const link = page.locator("[data-poster-list] a[data-hero-tile]:visible").first();
      const slug = await link.getAttribute("data-hero-tile");
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/products/${slug}`));
      const events = await page.evaluate(() => (window as unknown as HeroWindow).__heroEvents);
      expect(events.find((e) => e.name === "hero_tile_click")?.props).toMatchObject({
        slug,
        animated: false,
      });
    });
  });

  test("does not load the animation on data saver", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "connection", {
        value: { saveData: true, effectiveType: "4g" },
      });
    });
    const stageChunks = watchScripts(page);
    await page.goto("/home?vibe=cute");
    await expect(page.getByTestId("hero-shop")).toBeVisible();
    await page.waitForTimeout(3500);
    await expect(page.locator("[data-hero-stage-inner]")).toHaveCount(0);
    expect(await stageChunks()).toBe(0);
  });

  test("does not load the animation on a 2g connection", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "connection", {
        value: { saveData: false, effectiveType: "2g" },
      });
    });
    const stageChunks = watchScripts(page);
    await page.goto("/home?vibe=cute");
    await page.waitForTimeout(3500);
    await expect(page.locator("[data-hero-stage-inner]")).toHaveCount(0);
    expect(await stageChunks()).toBe(0);
  });

  test("removes the stage and returns to the poster when reduced motion is switched on", async ({
    page,
  }) => {
    await openHero(page);
    // While the stage runs the poster tiles are inert (the stage tiles are the links), but still laid out.
    await expect(page.locator("[data-poster-list]").first()).toHaveAttribute("inert", "");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("[data-hero-stage-inner]")).toHaveCount(0);
    await expect(page.locator("[data-poster-list]").first()).not.toHaveAttribute("inert", "");
    await expect(page.locator("[data-hero]")).not.toHaveAttribute("data-stage", "on");
    await expect(page.getByTestId("hero-shop")).toBeVisible();
  });
});

test.describe("controls", () => {
  test("Pause/Play toggle works by keyboard (WCAG 2.2.2)", async ({ page }) => {
    await openHero(page);
    const toggle = page.locator("[data-stage-toggle]");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAccessibleName("Pause hero animation");

    // Visible, bottom-right of the hero.
    const hero = (await page.locator("[data-hero]").boundingBox())!;
    const box = (await toggle.boundingBox())!;
    expect(box.x + box.width).toBeGreaterThan(hero.x + hero.width * 0.8);
    expect(box.y).toBeGreaterThan(hero.y + hero.height * 0.8);
    expect(box.height).toBeGreaterThanOrEqual(44);

    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAccessibleName("Play hero animation");
    expect((await state(page)).paused).toContain("user");
    const before = (await state(page)).t;
    await page.waitForTimeout(600);
    expect((await state(page)).t).toBe(before); // the timeline really stopped

    await page.keyboard.press("Space");
    await expect(toggle).toHaveAccessibleName("Pause hero animation");
    expect((await state(page)).paused).not.toContain("user");
    await expect.poll(async () => (await state(page)).t).not.toBe(before);

    const events = await page.evaluate(() => (window as unknown as HeroWindow).__heroEvents);
    expect(events.map((e) => e.name)).toEqual(expect.arrayContaining(["hero_pause", "hero_play"]));
  });

  test("hover pauses and shows the product name", async ({ page, isMobile }) => {
    test.skip(isMobile, "hover is a pointer interaction");
    await openHero(page);
    await page.evaluate(() => (window as unknown as HeroWindow).__ifonliHero!.pause());
    await seek(page, 10.8); // rest frame: tiles sit on the poster cells and do not move
    const tile = page.locator('[data-stage-tile]:not([aria-hidden="true"])').nth(1);
    const name = await tile.getAttribute("aria-label");
    await tile.hover();
    expect((await state(page)).paused).toContain("hover");
    const label = page.locator("[data-stage-label]");
    await expect(label).toHaveAttribute("data-open", "true");
    await expect(label).toHaveText(name!);
    await page.mouse.move(2, 2);
    expect((await state(page)).paused).not.toContain("hover");
    await expect(label).toHaveAttribute("data-open", "false");
  });

  test("keyboard focus pauses and shows the product name; Escape dismisses the label", async ({
    page,
  }) => {
    await openHero(page);
    const tile = page.locator('[data-stage-tile]:not([aria-hidden="true"])').first();
    const name = await tile.getAttribute("aria-label");
    await tile.focus();
    expect((await state(page)).paused).toContain("focus");
    const label = page.locator("[data-stage-label]");
    await expect(label).toHaveAttribute("data-open", "true");
    await expect(label).toHaveText(name!);
    await page.keyboard.press("Escape");
    await expect(label).toHaveAttribute("data-open", "false");
    await tile.blur();
    expect((await state(page)).paused).not.toContain("focus");
  });

  test("tab order reaches the Pause control before the moving tiles, and tiles are real links", async ({
    page,
  }) => {
    await openHero(page);
    const first = await page.evaluate(() => {
      const inStage = [
        ...document.querySelectorAll("[data-hero-stage-inner] a, [data-hero-stage-inner] button"),
      ];
      return inStage[0]?.tagName;
    });
    expect(first).toBe("BUTTON");
    const links = page.locator('[data-stage-tile]:not([aria-hidden="true"])');
    const n = await links.count();
    expect(n).toBeGreaterThanOrEqual(8);
    for (let i = 0; i < n; i += 1) {
      const href = await links.nth(i).getAttribute("href");
      expect(href).toMatch(/^\/products\/[a-z0-9-]+$/);
      expect(await links.nth(i).getAttribute("aria-label")).toBeTruthy();
    }
    // Repeats are hidden from assistive tech and the tab order.
    const dup = page.locator('[data-stage-tile][aria-hidden="true"]').first();
    await expect(dup).toHaveAttribute("tabindex", "-1");
  });

  test("a stage tile navigates to its product and reports hero_tile_click", async ({
    page,
    isMobile,
  }) => {
    await openHero(page);
    await page.evaluate(() => (window as unknown as HeroWindow).__ifonliHero!.pause());
    await seek(page, 10.8);
    const tile = page.locator('[data-stage-tile]:not([aria-hidden="true"])').first();
    const slug = await tile.getAttribute("data-hero-tile");
    if (isMobile) await tile.tap();
    else await tile.click();
    await expect(page).toHaveURL(new RegExp(`/products/${slug}`));
    const events = await page.evaluate(() => (window as unknown as HeroWindow).__heroEvents);
    expect(events.find((e) => e.name === "hero_tile_click")?.props).toMatchObject({
      slug,
      animated: true,
    });
  });

  test("pauses when scrolled off screen and when the tab is hidden", async ({ page }) => {
    await openHero(page);
    // On screen at the top: playing.
    await expect.poll(async () => (await state(page)).paused).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(async () => (await state(page)).paused).toContain("offscreen");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => (await state(page)).paused).not.toContain("offscreen");

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect((await state(page)).paused).toContain("hidden");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect((await state(page)).paused).not.toContain("hidden");
  });

  test("reports hero_impression once the hero has been visible for a second", async ({ page }) => {
    await openHero(page);
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => (window as unknown as HeroWindow).__heroEvents)).map(
            (e) => e.name,
          ),
        {
          timeout: 8000,
        },
      )
      .toContain("hero_impression");
    const events = await page.evaluate(() => (window as unknown as HeroWindow).__heroEvents);
    expect(events.filter((e) => e.name === "hero_impression")).toHaveLength(1);
    expect(events.find((e) => e.name === "hero_impression")?.props).toMatchObject({ vibe: "cute" });
  });
});

test.describe("every frame", () => {
  for (const vibe of VIBES) {
    test(`Shop button is visible, unobstructed and in the viewport at 12 sampled timestamps (${vibe})`, async ({
      page,
    }) => {
      await openHero(page, vibe);
      await page.evaluate(() => (window as unknown as HeroWindow).__ifonliHero!.pause());
      const shop = page.getByTestId("hero-shop");
      await shop.scrollIntoViewIfNeeded();
      const times = Array.from(
        { length: 12 },
        (_, i) => Math.round(((i + 0.5) * 12 * 1000) / 12) / 1000,
      );
      expect(times).toHaveLength(12);
      for (const t of times) {
        await seek(page, t);
        await expect(shop).toBeVisible();
        const hit = await shop.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const inViewport =
            r.top >= 0 &&
            r.bottom <= window.innerHeight &&
            r.left >= 0 &&
            r.right <= window.innerWidth;
          return {
            onTop: !!top && (el === top || el.contains(top)),
            inViewport,
            w: r.width,
            h: r.height,
          };
        });
        expect(hit.onTop, `Shop obstructed at t=${t}s in ${vibe}`).toBe(true);
        expect(hit.w).toBeGreaterThan(40);
        expect(hit.h).toBeGreaterThan(30);
        // The text card keeps its own opaque surface above every layer.
        const cardOpacity = await page
          .locator("[data-hero-card]")
          .evaluate((el) => getComputedStyle(el).opacity);
        expect(cardOpacity).toBe("1");
      }
      // And the frame is not blank: something besides the card is drawn at the sampled timestamps.
      await seek(page, 2.0);
      await page
        .locator("[data-hero]")
        .screenshot({ path: test.info().outputPath(`hero-${vibe}-2.0s.png`) });
    });

    test(`dissolves and flashes stay within WCAG 2.3.1 over the whole loop (${vibe})`, async ({
      page,
    }) => {
      await openHero(page, vibe);
      await page.evaluate(() => (window as unknown as HeroWindow).__ifonliHero!.pause());
      // Sample the two colour veils every 50 ms and split them into monotone runs.
      const report = await page.evaluate(async () => {
        const hook = (window as unknown as HeroWindow).__ifonliHero!;
        const dark = document.querySelector<HTMLElement>('[data-stage-veil="dark"]')!;
        const solid = document.querySelector<HTMLElement>('[data-stage-veil="solid"]')!;
        const step = 0.05;
        const d: number[] = [];
        const c: number[] = [];
        for (let t = 0; t < 12; t += step) {
          hook.seek(t);
          d.push(Number(getComputedStyle(dark).opacity));
          c.push(Number(getComputedStyle(solid).opacity));
        }
        const runs: {
          layer: string;
          from: number;
          seconds: number;
          delta: number;
          covered: boolean;
        }[] = [];
        const scan = (layer: string, v: number[]) => {
          let i = 0;
          while (i < v.length - 1) {
            const first = v[i + 1]! - v[i]!;
            if (Math.abs(first) < 1e-3) {
              i += 1;
              continue;
            }
            const dir = Math.sign(first);
            let j = i + 1;
            while (
              j < v.length - 1 &&
              Math.sign(v[j + 1]! - v[j]!) === dir &&
              Math.abs(v[j + 1]! - v[j]!) >= 1e-3
            )
              j += 1;
            // A change under a fully opaque solid veil is not visible.
            const covered = layer === "dark" && c[i]! >= 0.99 && c[j]! >= 0.99;
            runs.push({
              layer,
              from: i * step,
              seconds: (j - i) * step,
              delta: v[j]! - v[i]!,
              covered,
            });
            i = j;
          }
        };
        scan("dark", d);
        scan("solid", c);
        return runs.filter((r) => !r.covered);
      });
      expect(report.length).toBeGreaterThan(0);
      for (const run of report) {
        if (Math.abs(run.delta) >= 0.25) {
          expect(
            run.seconds,
            `${run.layer} luminance change at ${run.from}s lasts ${run.seconds}s`,
          ).toBeGreaterThanOrEqual(0.2);
        }
      }
      // Never more than 4 large transitions start in any second.
      const big = report.filter((r) => Math.abs(r.delta) >= 0.25).map((r) => r.from);
      for (const s of big)
        expect(big.filter((x) => x >= s && x < s + 1).length).toBeLessThanOrEqual(4);
    });
  }
});

test.describe("vibe switch", () => {
  test("the new motion profile starts at the next scene boundary, not before", async ({
    page,
    isMobile,
  }) => {
    test.skip(
      isMobile,
      "the hand button is exercised on desktop; the boundary logic is viewport independent",
    );
    await openHero(page, "cute");
    await page.evaluate(() => (window as unknown as HeroWindow).__ifonliHero!.pause());
    await seek(page, 2.5); // inside scene 3; the next boundary is 3.8
    const tilesBefore = await page
      .locator('[data-stage-tile]:not([aria-hidden="true"])')
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));

    await page.locator("button[data-vibe-hand]").first().click();
    await expect(page.locator("html")).toHaveAttribute("data-vibe", "bold");

    const s = await state(page);
    expect(s.profile).toBe("cute"); // still the old profile mid-scene
    expect(s.pending).toBe("bold");
    expect(s.pendingBoundary).toBeCloseTo(3.8, 2);
    const tilesMid = await page
      .locator('[data-stage-tile]:not([aria-hidden="true"])')
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(tilesMid).toEqual(tilesBefore); // products change with the profile, at the boundary

    // Run: the switch lands at the boundary.
    await page.evaluate(() => (window as unknown as HeroWindow).__ifonliHero!.play());
    await expect.poll(async () => (await state(page)).profile, { timeout: 8000 }).toBe("bold");
    const after = await state(page);
    expect(after.pending).toBeNull();
    expect(after.t).toBeGreaterThanOrEqual(3.8 - 0.05);
    expect(after.t).toBeLessThan(6);
    const tilesAfter = await page
      .locator('[data-stage-tile]:not([aria-hidden="true"])')
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(tilesAfter).not.toEqual(tilesBefore);
  });

  test("a switch very near a boundary waits for the following one (the dissolve needs 300 ms)", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "desktop only");
    await openHero(page, "cute");
    await page.evaluate(() => (window as unknown as HeroWindow).__ifonliHero!.pause());
    await seek(page, 3.7); // 0.1 s before the boundary at 3.8
    await page.locator("button[data-vibe-hand]").first().click();
    await expect(page.locator("html")).toHaveAttribute("data-vibe", "bold");
    const s = await state(page);
    expect(s.pending).toBe("bold");
    expect(s.pendingBoundary).toBeCloseTo(4.8, 2);
  });

  test("a switch while the visitor has paused applies at once", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop only");
    await openHero(page, "cute");
    await page.locator("[data-stage-toggle]").click();
    expect((await state(page)).paused).toContain("user");
    await page.locator("button[data-vibe-hand]").first().click();
    await expect.poll(async () => (await state(page)).profile).toBe("bold");
    expect((await state(page)).pending).toBeNull();
  });
});

test.describe("accessibility", () => {
  for (const vibe of VIBES) {
    test(`axe finds no violations in the home hero with the animation running (${vibe})`, async ({
      page,
    }) => {
      await openHero(page, vibe);
      await page.evaluate(() => (window as unknown as HeroWindow).__ifonliHero!.pause());
      await seek(page, 10.8); // rest frame: stable colours for the contrast checks
      const results = await new AxeBuilder({ page }).include("[data-hero]").analyze();
      expect(
        results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
        ),
      ).toEqual([]);
    });
  }

  test("axe finds no violations in the poster-only hero (reduced motion)", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/home?vibe=gothic");
    await expect(page.getByTestId("hero-shop")).toBeVisible();
    const results = await new AxeBuilder({ page }).include("[data-hero]").analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
    await context.close();
  });
});

test.describe("dev storyboard", () => {
  test("/dev/hero renders ten frames per vibe from the timeline", async ({ page }) => {
    await page.goto("/dev/hero");
    await expect(page.getByRole("heading", { name: "Hero storyboard" })).toBeVisible();
    for (const name of ["Mochi", "Chaos Cabinet", "Unapologetic", "After the Dark"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(page.locator("[data-testid^=frame-]")).toHaveCount(10);
      const frames = page.locator("[data-testid^=frame-]");
      for (let i = 0; i < 10; i += 1) await frames.nth(i).scrollIntoViewIfNeeded();
      await expect(page.locator("[data-hero-stage-inner][data-ready=true]")).toHaveCount(10, {
        timeout: 15_000,
      });
    }
  });
});
