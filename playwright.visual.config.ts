import { defineConfig } from "@playwright/test";

/**
 * Visual regression (`tests/visual`). Separate from `playwright.config.ts` so normal e2e runs never need
 * baselines, and gated by E2E_VISUAL=1 (the specs skip themselves without it).
 *
 *   NEXT_PUBLIC_ENABLE_DEV_PAGES=1 pnpm build && pnpm start -p 3108      # production build, seeded database
 *   E2E_VISUAL=1 E2E_BASE_URL=http://localhost:3108 pnpm visual            # compare against the baselines
 *   E2E_VISUAL=1 E2E_BASE_URL=http://localhost:3108 pnpm visual:update     # regenerate (see tests/visual/README.md)
 *
 * Projects are the three storefront widths; the admin screenshots run only in `visual-1440`.
 * Set PW_CHROMIUM_PATH to use a Chromium other than the one Playwright downloaded.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

const shared = {
  deviceScaleFactor: 1,
  colorScheme: "light",
  locale: "en-IN",
  timezoneId: "Asia/Kolkata",
  reducedMotion: "reduce",
  launchOptions: { executablePath },
} as const;

export default defineConfig({
  testDir: "./tests/visual",
  outputDir: "./test-results/visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report/visual" }]]
    : "list",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      // Anti-aliasing noise between runs of the same build is well under this; a moved element is not.
      maxDiffPixelRatio: 0.002,
      threshold: 0.2,
    },
  },
  use: { baseURL, trace: "retain-on-failure", ...shared },
  projects: [
    {
      name: "visual-390",
      use: { ...shared, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    },
    { name: "visual-768", use: { ...shared, viewport: { width: 768, height: 1024 } } },
    { name: "visual-1440", use: { ...shared, viewport: { width: 1440, height: 900 } } },
  ],
});
