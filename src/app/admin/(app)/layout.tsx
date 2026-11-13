import { Suspense } from "react";

import { AdminFrame, type FrameNavGroup } from "@/components/admin/shell/AdminFrame";
import { NAV, hrefFor } from "@/components/admin/nav";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { staffDisplayEmail, staffDisplayName } from "@/server/services/admin/staff-display";

/**
 * Authenticated admin shell. The session is read behind Suspense (cache components: request data
 * cannot be part of the static shell). `requireAdmin()` sends a missing session to /admin/login,
 * an un-enrolled admin to /admin/enroll-2fa. Pages and Server Actions re-check their own permission.
 */
/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-dvh" aria-busy />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  const groups: FrameNavGroup[] = NAV.map((g) => ({
    label: g.label,
    items: g.items
      .filter((i) => can(session.user.role, i.permission))
      .map((i) => ({ href: hrefFor(i), label: i.label, icon: i.icon, built: i.built })),
  })).filter((g) => g.items.length > 0);

  return (
    <AdminFrame
      groups={groups}
      user={{
        name: staffDisplayName(session.user.name, session.user.role),
        email: staffDisplayEmail(session.user.email, session.user.role) ?? "",
        role: session.user.role,
      }}
    >
      {children}
    </AdminFrame>
  );
}
