import type { Metadata } from "next";

import { CasesTable } from "@/components/admin/support/CasesTable";
import { InboxTable } from "@/components/admin/support/InboxTable";
import { ListPager } from "@/components/admin/support/ListPager";
import { DEFAULT_STATUS, supportHref, type FilterValues } from "@/components/admin/support/filters";
import { SupportFilterBar } from "@/components/admin/support/SupportFilterBar";
import { SupportTabs, type SupportTab } from "@/components/admin/support/SupportTabs";
import {
  CASE_STATUS_LABEL,
  CONTACT_STATUS_LABEL,
  TYPE_LABEL,
} from "@/components/admin/support/status";
import { PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { CONTACT_STATUSES, SUPPORT_STATUSES, SUPPORT_TYPES } from "@/server/domain/support-state";
import {
  getSupportCounts,
  type CaseListFilters,
  type ContactListFilters,
  listAssignableStaff,
  listContactMessages,
  listSupportCases,
} from "@/server/services/admin/support";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Support" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pick = <T extends string>(allowed: readonly T[], v: string | undefined): T | undefined =>
  v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

const STATUS_PICK = ["active", "all"] as const;

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdmin("support:view");
  const sp = await searchParams;
  const tab: SupportTab = one(sp.tab) === "cases" ? "cases" : "inbox";
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1);
  const q = one(sp.q)?.slice(0, 100) ?? "";
  const meId = session.user.id;

  const assignedParam = one(sp.assigned) ?? "";
  const assignedTo = assignedParam === "me" ? meId : assignedParam || undefined;
  const db = getDb();
  const [counts, staff] = await Promise.all([getSupportCounts(db), listAssignableStaff(db)]);

  const statusParam = one(sp.status);
  const values: FilterValues = {
    status:
      pick(
        [...STATUS_PICK, ...(tab === "inbox" ? CONTACT_STATUSES : SUPPORT_STATUSES)],
        statusParam,
      ) ?? DEFAULT_STATUS,
    type: tab === "cases" ? (pick(SUPPORT_TYPES, one(sp.type)) ?? "") : "",
    assigned: assignedParam,
    q,
  };
  // "all" means no status filter; the default is what still needs the team.
  const statusFilter = values.status === "all" ? undefined : values.status;

  const statusOptions = [
    { value: "active", label: "Needs attention" },
    { value: "all", label: "All" },
    ...(tab === "inbox"
      ? CONTACT_STATUSES.map((s) => ({ value: s, label: CONTACT_STATUS_LABEL[s] }))
      : SUPPORT_STATUSES.map((s) => ({ value: s, label: CASE_STATUS_LABEL[s] }))),
  ];

  let body: React.ReactNode;
  let pager: { total: number; page: number; pageCount: number; pageSize: number };
  if (tab === "inbox") {
    const list = await listContactMessages(db, {
      status: statusFilter as ContactListFilters["status"],
      assignedTo,
      q,
      page,
    });
    pager = list;
    body = (
      <InboxTable
        rows={list.items.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))}
        emptyMessage={
          values.status === DEFAULT_STATUS && !q && !assignedTo
            ? "Nothing needs attention. New messages from the Help page appear here."
            : "No messages match these filters."
        }
      />
    );
  } else {
    const list = await listSupportCases(db, {
      status: statusFilter as CaseListFilters["status"],
      type: (values.type || undefined) as CaseListFilters["type"],
      assignedTo,
      q,
      page,
    });
    pager = list;
    body = (
      <CasesTable
        rows={list.items.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
        emptyMessage={
          values.status === DEFAULT_STATUS && !q && !assignedTo && !values.type
            ? "No open cases. Problems reported from an order page appear here."
            : "No cases match these filters."
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Support"
        description="Messages from the Help page and problems reported on orders. The default view shows what still needs the team."
      />
      <SupportTabs active={tab} inboxOpen={counts.inbox.active} casesOpen={counts.cases.active} />
      <div className="flex flex-col gap-3">
        <SupportFilterBar
          tab={tab}
          values={values}
          statusOptions={statusOptions}
          typeOptions={
            tab === "cases"
              ? SUPPORT_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))
              : undefined
          }
          staff={staff.map((s) => ({ id: s.id, name: s.name }))}
          meId={meId}
        />
        {body}
        <ListPager
          noun={tab === "inbox" ? "messages" : "cases"}
          {...pager}
          prevHref={supportHref(tab, values, pager.page - 1)}
          nextHref={supportHref(tab, values, pager.page + 1)}
        />
      </div>
    </>
  );
}
