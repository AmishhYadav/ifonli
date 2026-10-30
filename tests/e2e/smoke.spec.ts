import { expect, test } from "@playwright/test";

test("home page responds with 200", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "IfOnli" })).toBeVisible();
});
