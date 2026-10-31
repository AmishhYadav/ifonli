import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, type Browser } from "@playwright/test";

import { totp } from "../e2e/helpers/totp";

import { sql } from "./db";

export interface AdminLogin {
  email: string;
  password: string;
  secret: string;
  /** Playwright storage state of the signed-in session (reuse it with `test.use({ storageState })`). */
  storageState: string;
}

export type AdminRole = "owner" | "admin" | "fulfilment";

/**
 * Creates an admin with `scripts/create-admin.ts`, enrols two-factor through the UI (the manual key is
 * read from the page and turned into a code, exactly what an authenticator app does) and returns the
 * saved session. One code can be used once per 30 s window, so callers reuse the storage state.
 */
export async function createAdminSession(
  browser: Browser,
  baseURL: string,
  role: AdminRole = "owner",
  stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`,
): Promise<AdminLogin> {
  const email = `qa-admin-${role}-${stamp}@ifonli.local`;
  const password = `Qa-Admin-${stamp}-Pw!`;
  execFileSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "--conditions=react-server",
      "scripts/create-admin.ts",
      "--email",
      email,
      "--role",
      role,
      "--password",
      password,
    ],
    { stdio: "pipe", env: { ...process.env, NODE_ENV: "development" } },
  );

  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("/admin/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Set up two-factor sign-in" })).toBeVisible();
  await page.getByLabel("Confirm your password").fill(password);
  await page.getByRole("button", { name: "Show QR code" }).click();
  await page.getByText("Can't scan?").click();
  const secret = (await page.locator("details code").innerText()).trim();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify and turn on" }).click();
  await expect(page.getByRole("heading", { name: "Save your backup codes" })).toBeVisible();
  await page.getByRole("button", { name: /I have saved them/ }).click();
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
  const storageState = path.join(tmpdir(), `ifonli-qa-admin-${role}-${stamp}.json`);
  await context.storageState({ path: storageState });
  await context.close();
  return { email, password, secret, storageState };
}

/** Removes the admin accounts the QA specs created (and their sessions, 2FA rows and audit entries). */
export async function cleanupQaAdmins(): Promise<void> {
  await sql`
    delete from admin_audit_log
    where actor_id in (select id from "user" where email like 'qa-admin-%@ifonli.local')`;
  await sql`delete from "user" where email like 'qa-admin-%@ifonli.local'`;
}
