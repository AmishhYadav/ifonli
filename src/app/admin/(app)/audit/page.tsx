import type { Metadata } from "next";

import { AuditLog } from "@/components/admin/audit/AuditLog";
import { PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getAuditFacets, listAuditLog } from "@/server/services/admin/audit";

import { auditFiltersFromParams } from "./filters";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdmin("audit:view");
  const { page: pageNumber, ...filters } = auditFiltersFromParams(await searchParams);
  const db = getDb();
  const viewer = { role: session.user.role };
  const [page, facets] = await Promise.all([
    listAuditLog(db, viewer, { ...filters, page: pageNumber }),
    getAuditFacets(db, viewer),
  ]);
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change made in the admin: who, what, when, and the before and after values. Read-only."
      />
      <AuditLog page={page} filters={filters} facets={facets} />
    </>
  );
}
