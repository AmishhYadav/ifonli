import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.E2E_BASE_URL;
const baseURL = externalBaseURL ?? "http://localhost:3000";

// Optional: run against a Chromium that is not the build Playwright expects (sandboxes with an older
// pre-installed browser). Never needed in CI, where `playwright install` fetches the matching build.
const chromiumPath = process.env.PW_CHROMIUM_PATH;
const launchOptions = chromiumPath ? { executablePath: chromiumPath } : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Loaded machines (and first compiles under `pnpm dev`) can exceed the 5 s default, e.g. the order page after payment.
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    ...(launchOptions ? { launchOptions } : {}),
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    { name: "mobile-pixel-7", use: { ...devices["Pixel 7"] } },
    { name: "mobile-iphone-14", use: { ...devices["iPhone 14"] } },
  ],
  // Start the dev server only when not testing an external deployment.
  webServer: externalBaseURL
    ? undefined
    : {
        command: "pnpm dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
