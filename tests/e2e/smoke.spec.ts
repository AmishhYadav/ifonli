import { expect, test } from "@playwright/test";

test("landing page (/) responds with 200 and one h1", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("store home (/home) responds with 200", async ({ page }) => {
  const response = await page.goto("/home");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
