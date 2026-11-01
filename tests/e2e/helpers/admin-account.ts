import { execFileSync } from "node:child_process";

/**
 * Creates (or updates) a staff account with `scripts/create-admin.ts`, the way an owner would.
 *
 * Every spec signs in from the same address, so a full local run with E2E_ADMIN_FLOW=1 enrols more
 * accounts than the per-IP admin limits allow in ten minutes (those limits protect production and
 * stay as they are). On a local database this also empties the admin buckets; it never touches a
 * remote one.
 */
export function createAdminAccount(email: string, password: string, role: string): void {
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
    { stdio: "pipe" },
  );
  execFileSync("pnpm", ["exec", "tsx", "tests/e2e/helpers/clear-admin-rate-limits.ts"], {
    stdio: "pipe",
  });
}
