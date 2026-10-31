import type { AuditFilters } from "@/server/services/admin/audit";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const date = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const text = (v: string | undefined, max: number) => {
  const t = v?.trim().slice(0, max);
  return t ? t : undefined;
};

/** Filters from URL search params (shared by the page and the CSV route); bad values are dropped. */
export function auditFiltersFromParams(
  params: Record<string, string | string[] | undefined>,
): AuditFilters & { page: number } {
  return {
    actorId: text(one(params.actorId), 100),
    actor: text(one(params.actor), 100),
    entity: text(one(params.entity), 60),
    entityId: text(one(params.entityId), 200),
    action: text(one(params.action), 80),
    from: date(one(params.from)),
    to: date(one(params.to)),
    page: Math.max(1, Number.parseInt(one(params.page) ?? "1", 10) || 1),
  };
}
