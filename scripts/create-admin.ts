/**
 * Create or update an admin account (email + password; TOTP is enrolled at first login, D-AUTH-1).
 *
 *   pnpm exec tsx --conditions=react-server scripts/create-admin.ts --email owner@ifonli.local --role owner
 *
 * Options
 *   --email <email>       required
 *   --role <role>         owner | admin | fulfilment   (default owner)
 *   --name <name>         display name (default: the part before the @)
 *   --password <pw>       at least 12 characters, not containing "ifonli", "password" or "admin", not the
 *                         e-mail's first part, not one repeated character; and not in known data
 *                         breaches (checked online: only a 5-character hash prefix leaves this machine;
 *                         if the check cannot run it warns and goes on). Omitted = a strong random one
 *                         is generated and printed once (or set ADMIN_PASSWORD to keep it out of shell history)
 *   --reset-2fa           drop the existing authenticator so TOTP is enrolled again at next login
 *
 * Safe to re-run: an existing account is updated (role, password), never duplicated. Refuses to
 * touch a database that is not on this machine unless --allow-remote is given (--force is accepted
 * as the older spelling).
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

import { config } from "dotenv";

import { requireLocalOrAllowRemote } from "./db-guard";

config({ path: ".env.local" });
config();

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      role: { type: "string", default: "owner" },
      name: { type: "string" },
      password: { type: "string" },
      "reset-2fa": { type: "boolean", default: false },
      "allow-remote": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
  });
  if (!values.email) throw new Error("--email is required");
  requireLocalOrAllowRemote("create-admin", "create or change an admin account", values.force ? [...process.argv, "--allow-remote"] : process.argv);

  // `||`, not `??`: .env.example ships ADMIN_PASSWORD= (empty), which must mean "generate one".
  const generated = !values.password && !process.env.ADMIN_PASSWORD;
  const password =
    values.password || process.env.ADMIN_PASSWORD || randomBytes(15).toString("base64url");

  if (!generated) {
    // A password a person chose gets the same rules as the admin screens. Generated ones are random and skip them.
    const { adminPasswordProblem, describeAdminPasswordProblem } = await import("../src/server/auth/password-policy");
    const problem = adminPasswordProblem(password, values.email);
    if (problem) throw new Error(describeAdminPasswordProblem(problem));
    const { checkPasswordBreach, BREACHED_PASSWORD_MESSAGE } = await import("../src/server/auth/password-breach");
    const breach = await checkPasswordBreach(password);
    if (breach === "breached") throw new Error(BREACHED_PASSWORD_MESSAGE);
    // An operator is at the keyboard, unlike the web flow: do not block on a network problem.
    if (breach === "unavailable") console.warn("warning: could not check the password against known data breaches (offline?); continuing");
  }

  const { getDb } = await import("../src/server/db");
  const { upsertAdminUser } = await import("../src/server/auth/admin-user");
  const result = await upsertAdminUser(getDb(), {
    email: values.email,
    role: values.role as "owner" | "admin" | "fulfilment",
    name: values.name,
    password,
    resetTwoFactor: values["reset-2fa"],
  });

  console.log(
    `${result.created ? "created" : "updated"} ${values.role} ${values.email.toLowerCase()}`,
  );
  if (generated) console.log(`generated password (shown once): ${password}`);
  console.log("Sign in at /admin/login; you will be asked to set up an authenticator app.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
