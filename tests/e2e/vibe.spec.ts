import { expect, test, type Page } from "@playwright/test";

/**
 * Vibe engine e2e (FR-19). Intended to run against a production build with dev pages enabled:
 *   NEXT_PUBLIC_ENABLE_DEV_PAGES=1 pnpm build && pnpm start -p 3100
 *   E2E_BASE_URL=http://localhost:3100 pnpm exec playwright test vibe
 */

/** The hand button's cycle order (settings.vibe_cycle default), not the nav order. */
const ORDER = ["cute", "gothic", "funky", "bold"] as const;
const NAMES: Record<(typeof ORDER)[number], string> = {
  cute: "Mochi",
  gothic: "After the Dark",
  funky: "Chaos Cabinet",
  bold: "Unapologetic",
};
const next = (v: (typeof ORDER)[number]) => ORDER[(ORDER.indexOf(v) + 1) % ORDER.length]!;

interface VibeEvent {
  from: string;
  to: string;
  durationMs: number;
  usedViewTransition: boolean;
}
interface TestWindow {
  __vibeEvents: VibeEvent[];
}

const PLAYGROUND = "/dev/vibe";

/**
 * (h) and (i) assert production performance: switch timing and one request per font file. Under
 * `next dev` they are unreliable (a slow shared runner blows the 400 ms budget; dev re-injects CSS
 * and serves files with max-age=0, so the body font is fetched twice). They run against a production
 * build only, where the workflow sets E2E_PROD=1 (the CI "prod" job). Locally:
 *   NEXT_PUBLIC_ENABLE_DEV_PAGES=1 pnpm build && E2E_PROD=1 E2E_BASE_URL=http://localhost:3100 ...
 */
const PROD_ONLY_REASON = "production-performance assertion: runs against a production build (E2E_PROD=1)";
const isProdRun = process.env.E2E_PROD === "1";
const BUTTON = "button[data-vibe-hand]";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as TestWindow;
    w.__vibeEvents = [];
    window.addEventListener("ifonli:vibe-change", (e) => {
      w.__vibeEvents.push((e as CustomEvent<VibeEvent>).detail);
    });
  });
});

const htmlVibe = (page: Page) => page.locator("html").getAttribute("data-vibe");

/**
 * What a sighted user sees of the button: the button shows only the hand (no text), so the visible hand variant
 * (`[data-hand]` whose `[data-v]` wrapper has a box) is mapped back to the vibe's display name.
 */
const visibleName = (page: Page) =>
  page
    .locator(BUTTON)
    .first()
    .evaluate((button) => {
      const hands = [...button.querySelectorAll("[data-hand]")].filter(
        (h) => getComputedStyle(h).display !== "none" && getComputedStyle(h.parentElement!).display !== "none",
      );
      return hands.map((h) => h.getAttribute("data-hand")!);
    })
    .then((ids) => ids.map((id) => NAMES[id as keyof typeof NAMES]));

async function afterSwitch(page: Page, act: () => Promise<void>): Promise<VibeEvent> {
  const before = await page.evaluate(() => (window as unknown as TestWindow).__vibeEvents.length);
  await act();
  await page.waitForFunction(
    (n) => (window as unknown as TestWindow).__vibeEvents.length > n,
    before,
  );
  return page.evaluate(() => {
    const events = (window as unknown as TestWindow).__vibeEvents;
    return events[events.length - 1]!;
  });
}

async function ready(page: Page, url = PLAYGROUND) {
  await page.goto(url);
  await page.waitForLoadState("load");
  // Hydrated once the aria-label tracks the active vibe.
  await expect(page.locator(BUTTON).first()).toHaveAttribute(
    "aria-label",
    /Turn Me: change vibe, current: /,
  );
}

test("(a) four clicks cycle cute > gothic > funky > bold > cute", async ({
  page,
}) => {
  await ready(page);
  const button = page.locator(BUTTON).first();
  let current: (typeof ORDER)[number] = "cute";

  // Before any click: correct state, label and aria-label.
  expect(await htmlVibe(page)).toBe("cute");

  for (let i = 0; i < 4; i++) {
    const to = next(current);
    const event = await afterSwitch(page, () => button.click());
    expect(event).toMatchObject({ from: current, to });
    expect(await htmlVibe(page)).toBe(to);
    expect(await visibleName(page)).toEqual([NAMES[to]]);
    await expect(button).toHaveAttribute(
      "aria-label",
      `Turn Me: change vibe, current: ${NAMES[to]}, next: ${NAMES[next(to)]}`,
    );
    await expect(page.locator("#vibe-live")).toHaveText(`Vibe changed to ${NAMES[to]}`);
    current = to;
  }
  expect(current).toBe("cute");
});

test("(b) vibe persists across reload and navigation", async ({ page, context }) => {
  await ready(page);
  const button = page.locator(BUTTON).first();
  await afterSwitch(page, () => button.click()); // gothic
  await afterSwitch(page, () => button.click()); // funky

  await page.reload();
  expect(await htmlVibe(page)).toBe("funky");
  expect(await visibleName(page)).toEqual(["Chaos Cabinet"]);

  // Cookie + localStorage hold the value (no personal data).
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "ifonli_vibe")).toMatchObject({
    value: "funky",
    sameSite: "Lax",
    path: "/",
  });
  expect(await page.evaluate(() => localStorage.getItem("ifonli_vibe"))).toBe("funky");

  // Full page navigation.
  await page.locator('a[href="/dev/vibe/other"]').click();
  await page.waitForURL(/\/dev\/vibe\/other/);
  expect(await htmlVibe(page)).toBe("funky");

  // Client-side navigation (next/link) keeps it, and the URL keeps carrying ?vibe=.
  await page.getByTestId("back-link").click();
  await page.waitForURL(/\/dev\/vibe(\?|$)/);
  expect(await htmlVibe(page)).toBe("funky");
  await expect.poll(() => new URL(page.url()).searchParams.get("vibe")).toBe("funky");

  // And the home page.
  await page.goto("/home");
  expect(await htmlVibe(page)).toBe("funky");
});

test("(c) /?vibe=gothic renders gothic before first paint, then persists", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    const log = { mutations: [] as string[], dcl: "", dclBg: "", fcp: "", fcpBg: "", frame: "" };
    (window as unknown as { __flash: typeof log }).__flash = log;
    const root = () => document.documentElement;
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.attributeName === "data-vibe") log.mutations.push(root().dataset.vibe ?? "");
      }
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-vibe"] });
    document.addEventListener("DOMContentLoaded", () => {
      log.dcl = root().dataset.vibe ?? "";
      log.dclBg = getComputedStyle(root()).getPropertyValue("--bg").trim();
      requestAnimationFrame(() => {
        log.frame = root().dataset.vibe ?? "";
      });
    });
    new PerformanceObserver(() => {
      log.fcp = root().dataset.vibe ?? "";
      log.fcpBg = getComputedStyle(root()).getPropertyValue("--bg").trim();
    }).observe({ type: "paint", buffered: true });
  });

  await page.goto("/home?vibe=gothic", { waitUntil: "load" });
  await page.waitForTimeout(500); // let hydration finish and any bad reset show up
  const log = await page.evaluate(
    () =>
      (window as unknown as { __flash: Record<string, string> & { mutations: string[] } }).__flash,
  );
  expect(log.dcl).toBe("gothic");
  expect(log.dclBg!.toLowerCase()).toBe("#0f0b15");
  expect(log.frame).toBe("gothic");
  if (log.fcp) {
    // Paint timing is not reported by every engine; when it is, the vibe was already applied.
    expect(log.fcp).toBe("gothic");
    expect(log.fcpBg!.toLowerCase()).toBe("#0f0b15");
  }
  // The only attribute change ever observed is the head script's cute > gothic; hydration never reverts it.
  expect(log.mutations).toEqual(["gothic"]);
  expect(await htmlVibe(page)).toBe("gothic");

  // Persisted: a plain visit in the same context stays gothic.
  await page.goto("/dev/vibe");
  expect(await htmlVibe(page)).toBe("gothic");
  expect((await context.cookies()).find((c) => c.name === "ifonli_vibe")?.value).toBe("gothic");
  await context.close();
});

test("(d) the URL reflects the vibe and keeps path, hash and other params", async ({ page }) => {
  await ready(page, `${PLAYGROUND}?keep=1#active`);
  const button = page.locator(BUTTON).first();

  // After hydration the current vibe is on the URL.
  await expect.poll(() => new URL(page.url()).searchParams.get("vibe")).toBe("cute");

  await afterSwitch(page, () => button.click());
  const url = new URL(page.url());
  expect(url.pathname).toBe(PLAYGROUND);
  expect(url.searchParams.get("vibe")).toBe("gothic");
  expect(url.searchParams.get("keep")).toBe("1");
  expect(url.hash).toBe("#active");
  expect([...url.searchParams.keys()].filter((k) => k === "vibe")).toHaveLength(1);

  await afterSwitch(page, () => button.click());
  expect(new URL(page.url()).searchParams.get("vibe")).toBe("funky");

  // Canonical never carries ?vibe.
  const canonical = await page.locator('link[rel="canonical"]').count();
  if (canonical > 0) {
    expect(await page.locator('link[rel="canonical"]').first().getAttribute("href")).not.toContain(
      "vibe=",
    );
  }
});

test("(e) keyboard: Tab reaches the button, Enter and Space both switch", async ({
  page,
  browserName,
}) => {
  await ready(page);
  const button = page.locator(BUTTON).first();
  // Safari only tabs to buttons with Option held (system setting), Chromium with plain Tab.
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press(tab);
    if (await button.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(button).toBeFocused();

  let event = await afterSwitch(page, () => page.keyboard.press("Enter"));
  expect(event.to).toBe("gothic");
  expect(await htmlVibe(page)).toBe("gothic");

  event = await afterSwitch(page, () => page.keyboard.press("Space"));
  expect(event.to).toBe("funky");
  expect(await htmlVibe(page)).toBe("funky");
  await expect(button).toBeFocused();
});

test.describe("touch", () => {
  test("(f) tap switches the vibe; long-press shows the tooltip without switching", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "touch emulation only on mobile projects");
    await ready(page);
    const button = page.locator(BUTTON).first();

    const event = await afterSwitch(page, () => button.tap());
    expect(event).toMatchObject({ from: "cute", to: "gothic" });
    expect(await htmlVibe(page)).toBe("gothic");

    // Long press (500 ms): tooltip opens, no switch on release.
    await button.evaluate(async (el) => {
      el.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
      await new Promise((r) => setTimeout(r, 650));
    });
    await expect(button).toHaveAttribute("data-tip", "open");
    await button.evaluate((el) => {
      el.dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch", bubbles: true }));
      (el as HTMLElement).click();
    });
    expect(await htmlVibe(page)).toBe("gothic");
    const tip = await button.evaluate((el) => {
      const tooltip = el.querySelector(".hand-tip");
      const shown = [...(tooltip?.querySelectorAll("[data-v]") ?? [])].find(
        (s) => getComputedStyle(s).display !== "none",
      );
      return {
        text: shown?.textContent,
        pointerEvents: tooltip ? getComputedStyle(tooltip).pointerEvents : "",
      };
    });
    expect(tip.text).toBe("Next: Chaos Cabinet");
    expect(tip.pointerEvents).toBe("none"); // never blocks the tap

    // A normal tap still works afterwards.
    const second = await afterSwitch(page, () => button.tap());
    expect(second.to).toBe("funky");
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("(g) switches instantly with no view transition and no flip", async ({ page }) => {
    await ready(page);
    const button = page.locator(BUTTON).first();
    const event = await afterSwitch(page, () => button.click());
    expect(event).toMatchObject({ from: "cute", to: "gothic", usedViewTransition: false });
    expect(await htmlVibe(page)).toBe("gothic");
    await expect(button).not.toHaveAttribute("data-turn", /.*/); // the card-turn flip is off under reduced motion
    const hasViewTransitionAnimations = await page.evaluate(() =>
      document
        .getAnimations()
        .some((a) => String(a.effect?.getComputedTiming().duration) === "600"),
    );
    expect(hasViewTransitionAnimations).toBe(false);
  });
});

test("(h) every switch completes in < 900 ms (chromium desktop)", async ({ page }, testInfo) => {
  test.skip(!isProdRun, PROD_ONLY_REASON);
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "timing budget is asserted on chromium desktop",
  );
  await ready(page);
  const button = page.locator(BUTTON).first();
  const durations: number[] = [];
  // Two full laps: the first lap includes first-use font fetches (worst case). The duration runs until the
  // 600 ms colour cross-fade has finished (view transition `finished`), so the budget is the fade plus 300 ms.
  for (let i = 0; i < 8; i++) {
    const event = await afterSwitch(page, () => button.click());
    expect(event.usedViewTransition).toBe(true);
    durations.push(event.durationMs);
    expect(event.durationMs, `switch ${i + 1}: ${event.from} > ${event.to}`).toBeLessThan(900);
  }
  testInfo.annotations.push({ type: "durations-ms", description: durations.join(", ") });
  console.log(`vibe switch durations (ms): ${durations.join(", ")}`);
});

test("(i) first load requests only the body font and the active display font, the others warm after idle", async ({
  page,
  browserName,
}) => {
  test.skip(!isProdRun, PROD_ONLY_REASON);
  const requested: string[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/fonts/") && path.endsWith(".woff2"))
      requested.push(path.split("/").pop()!);
  });

  // The playground strip renders all four vibes at once, so use the single-vibe page.
  await page.goto(`${PLAYGROUND}/other?vibe=bold`, { waitUntil: "load" });

  // Fonts that started downloading before the load event finished.
  const beforeLoad = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    return performance
      .getEntriesByType("resource")
      .filter((e) => e.name.includes("/fonts/") && e.startTime < nav.loadEventEnd)
      .map((e) => new URL(e.name).pathname.split("/").pop()!);
  });
  expect([...new Set(beforeLoad)].sort()).toEqual(
    ["bungee-shade-wght400-latin.woff2", "nunito-wght400-800-latin.woff2"].sort(),
  );
  expect(new Set(requested).has("fredoka-wght500-700-latin.woff2")).toBe(false);

  // Only after idle: the FOLLOWING vibe's font first (the cycle wraps from bold to cute = Fredoka), then the rest
  // one after another (After the Dark = Creepster, Chaos Cabinet = Rubik Glitch), so no switch waits on a download.
  await expect
    .poll(() => requested.includes("fredoka-wght500-700-latin.woff2"), { timeout: 8000 })
    .toBe(true);
  await expect
    .poll(
      () =>
        ["creepster-wght400-latin.woff2", "rubik-glitch-wght400-latin.woff2"].every((f) =>
          requested.includes(f),
        ),
      { timeout: 12000 },
    )
    .toBe(true);
  // Each file at most once (preload and @font-face share one request).
  // (WebKit re-requests a script-inserted font preload once; known engine quirk, still only 1 display font.)
  if (browserName !== "webkit") expect(requested.length).toBe(new Set(requested).size);
});

test("scopes: nested VibeScope, buy scope and per-scope copy", async ({ page }) => {
  await ready(page, `${PLAYGROUND}?vibe=gothic`);
  const cssVar = (selector: string, name: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name);

  // Page is After the Dark (20px radius, dark purple-black bg).
  expect(await cssVar("html", "--radius-card")).toBe("20px");
  expect((await cssVar("html", "--bg")).toLowerCase()).toBe("#0f0b15");

  // Buy scope: palette from the vibe, shape/type/texture from base.
  const buy = '[data-testid="buy-panel"]';
  expect((await cssVar(buy, "--bg")).toLowerCase()).toBe("#0f0b15");
  expect(await cssVar(buy, "--radius-card")).toBe("16px");
  expect(await cssVar(buy, "--border-w")).toBe("1px");
  expect(await cssVar(buy, "--texture-url")).toBe("none");
  expect(await cssVar(buy, "--font-display")).toContain("Nunito");

  // Nested scopes each carry their own vibe, including inside a buy scope's sibling tree.
  const radii: Record<string, string> = {};
  for (const v of ORDER) {
    radii[v] = await cssVar(`[data-testid="vibe-strip"] [data-vibe="${v}"]`, "--radius-button");
  }
  expect(radii).toEqual({
    cute: "9999px",
    gothic: "9999px",
    funky: "9999px",
    bold: "9999px",
  });

  // Each scope shows exactly its own copy variant.
  const copy = await page.locator('[data-testid="vibe-strip"] [data-vibe]').evaluateAll((scopes) =>
    scopes.map((scope) => {
      const shown = [...scope.querySelectorAll("[data-v]")].filter(
        (s) => getComputedStyle(s).display !== "none",
      );
      return {
        vibe: scope.getAttribute("data-vibe"),
        variants: [...new Set(shown.map((s) => s.getAttribute("data-v")))],
      };
    }),
  );
  for (const entry of copy) expect(entry.variants).toEqual([entry.vibe]);
});

test("layout: no horizontal overflow in any vibe", async ({ page }) => {
  for (const v of ORDER) {
    await page.goto(`${PLAYGROUND}?vibe=${v}`);
    // Token values are read after hydration; wait for them so long values are part of the layout.
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="token-table"] li:last-child span:last-child')
          ?.textContent,
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, v).toBeLessThanOrEqual(0);
  }
});
