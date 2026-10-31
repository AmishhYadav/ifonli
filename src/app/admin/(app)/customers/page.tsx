import type { Metadata } from "next";

import { CustomersTable } from "@/components/admin/customers/CustomersTable";
import { PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import {
  CUSTOMER_KINDS,
  CUSTOMER_SORTS,
  listCustomers,
  type CustomerKind,
  type CustomerSort,
} from "@/server/services/admin/customers";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Customers" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pick = <T extends string>(allowed: readonly T[], v: string | undefined): T | undefined =>
  v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin("customer:view");
  const sp = await searchParams;
  const q = one(sp.q)?.slice(0, 100) ?? "";
  const kind: CustomerKind | undefined = pick(CUSTOMER_KINDS, one(sp.kind));
  const sort: CustomerSort = pick(CUSTOMER_SORTS, one(sp.sort)) ?? "last_order";
  const dir = one(sp.dir) === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1);
  const list = await listCustomers(getDb(), { q, kind, sort, dir, page });

  return (
    <>
      <PageHeader
        title="Customers"
        description="Accounts and guest buyers in one list, with their orders and lifetime value. Open one to see their history or to answer a data request."
      />
      <CustomersTable
        rows={list.items.map((c) => ({
          ...c,
          joinedAt: c.joinedAt.toISOString(),
          lastOrderAt: c.lastOrderAt ? c.lastOrderAt.toISOString() : null,
        }))}
        total={list.total}
        page={list.page}
        pageCount={list.pageCount}
        pageSize={list.pageSize}
        filters={{ q, kind: kind ?? "", sort, dir }}
      />
    </>
  );
}
