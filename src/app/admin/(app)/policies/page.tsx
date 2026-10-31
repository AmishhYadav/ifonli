import type { Metadata } from "next";
import Link from "next/link";

import {
  Badge,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { istToday, listPoliciesAdmin } from "@/server/services/admin/policies";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Policies" };

export default async function PoliciesPage() {
  await requireAdmin("policy:view");
  const rows = await listPoliciesAdmin(getDb());
  return (
    <>
      <PageHeader
        title="Policies"
        description="Shipping, returns, privacy and the other legal pages. Edit a draft, then the owner publishes it. Each publish is a new version with an effective date."
      />
      <div className="overflow-hidden rounded-lg border border-admin-border bg-admin-surface shadow-xs">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Policy</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Effective</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.slug}>
                <TableCell>
                  <Link href={`/admin/policies/${p.slug}`} className="font-medium text-admin-primary hover:underline">
                    {p.title}
                  </Link>
                  <span className="block font-mono text-xs text-admin-ink-muted">/policies/{p.slug}</span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {!p.exists ? (
                      <Badge tone="neutral">Not created</Badge>
                    ) : p.published ? (
                      <Badge tone="success">Live</Badge>
                    ) : (
                      <Badge tone="warning">Not published</Badge>
                    )}
                    {p.exists && p.published && p.hasDraft ? <Badge tone="info">Draft pending</Badge> : null}
                  </div>
                </TableCell>
                <TableCell className="tabular">{p.version ?? "—"}</TableCell>
                <TableCell>{p.published && p.effectiveAt ? istToday(p.effectiveAt) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
