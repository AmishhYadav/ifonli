import { sql } from "drizzle-orm";

import { user } from "@/server/db/schema";

/**
 * The owner is never shown by name or e-mail in the admin: every place that would print a staff
 * member's name prints "Owner" for the owner account instead. Other staff keep their names.
 */
export const OWNER_LABEL = "Owner";

export function staffDisplayName(name: string, role: string): string;
export function staffDisplayName(name: string | null, role: string | null): string | null;
export function staffDisplayName(name: string | null, role: string | null): string | null {
  return role === "owner" ? OWNER_LABEL : name;
}

/** The owner's e-mail stays hidden too; null for the owner, the address for everyone else. */
export function staffDisplayEmail(email: string | null, role: string | null): string | null {
  return role === "owner" ? null : email;
}

/** SQL column: "Owner" for the owner account, the user's name otherwise (null when no user joined). */
export const staffNameSql = sql<
  string | null
>`case when ${user.role} = 'owner' then 'Owner' else ${user.name} end`;

/** SQL column: null for the owner account, the user's e-mail otherwise. */
export const staffEmailSql = sql<
  string | null
>`case when ${user.role} = 'owner' then null else ${user.email} end`;
