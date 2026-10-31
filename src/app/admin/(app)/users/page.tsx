import type { Metadata } from "next";

import { UsersManager } from "@/components/admin/users/UsersManager";
import { PageHeader } from "@/components/admin/ui";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listStaffUsers } from "@/server/services/admin/users";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const session = await requireAdmin("user:list");
  const users = await listStaffUsers(getDb());
  return (
    <>
      <PageHeader
        title="Users"
        description="Staff who can sign in to this admin. Everyone needs a password and an authenticator app. Customers are not listed here."
      />
      <UsersManager
        canManage={can(session.user.role, "user:create")}
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          banned: u.banned,
          banReason: u.banReason,
          twoFactorEnabled: u.twoFactorEnabled,
          activeSessions: u.activeSessions,
          lastSignInAt: u.lastSignInAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
          isSelf: u.id === session.user.id,
        }))}
      />
    </>
  );
}
