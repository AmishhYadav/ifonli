/**
 * Create or update an admin account (email + password; TOTP is enrolled at first login, D-AUTH-1).
 *
 *   pnpm exec tsx --conditions=react-server scripts/create-admin.ts --email owner@ifonli.local --role owner
 *
 * Options
 *   --email <email>       required
 *   --role <role>         owner | admin | fulfilment   (default owner)
 *   --name <name>         display name (default: the part before the @)
 *   --password <pw>       at least 12 characters; omitted = a strong random one is generated and printed
 *                         once (or set ADMIN_PASSWORD to keep it out of shell history)
 *   --reset-2fa           drop the existing authenticator so TOTP is enrolled again at next login
 *
 * Safe to re-run: an existing account is updated (role, password), never duplicated. Refuses to
 * touch a production database unless --force is given.
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

import { config } from "dotenv";

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
      force: { type: "boolean", default: false },
    },
  });
  if (!values.email) throw new Error("--email is required");
  if (process.env.NODE_ENV === "production" && !values.force) {
    throw new Error("NODE_ENV=production: pass --force to create an admin on this database");
  }

  const generated = !values.password && !process.env.ADMIN_PASSWORD;
  const password =
    values.password ?? process.env.ADMIN_PASSWORD ?? randomBytes(15).toString("base64url");

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
