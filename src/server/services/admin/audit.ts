import "server-only";

import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";

import { assertCan } from "@/server/auth/permissions";
import { adminAuditLog, user } from "@/server/db/schema";
import type { DbClient } from "@/server/services/queries/shared";

/**
 * Read-only view of `admin_audit_log` (`audit:view`): filter by actor, entity, action and an IST date
 * range, paginate, and export the same filter as CSV.
 */

export const AUDIT_PAGE_SIZE = 50;
/** One CSV download is capped so a runaway filter cannot exhaust memory. */
export const AUDIT_EXPORT_MAX = 20_000;

export interface AuditFilters {
  /** Exact actor user id. */
  actorId?: string;
  /** Free text matched against the actor's name or email. */
  actor?: string;
  entity?: string;
  entityId?: string;
  /** Exact action (`product.update`) or a prefix ending in `.*` (`product.*`). */
  action?: string;
  /** IST calendar dates, `YYYY-MM-DD`, both inclusive. */
  from?: string;
  to?: string;
}

export interface AuditRow {
  id: string;
  createdAt: Date;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  diff: unknown;
  ip: string | null;
}

export interface AuditPage {
  items: AuditRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Start of an IST calendar day as an instant. */
function istStart(date: string): Date | null {
  if (!DATE.test(date)) return null;
  const d = new Date(`${date}T00:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function where(filters: AuditFilters): SQL | undefined {
  const conds: (SQL | undefined)[] = [];
  if (filters.actorId) conds.push(eq(adminAuditLog.actorId, filters.actorId));
  if (filters.actor?.trim()) {
    const like = `%${escapeLike(filters.actor.trim())}%`;
    conds.push(or(ilike(user.name, like), ilike(user.email, like)));
  }
  if (filters.entity) conds.push(eq(adminAuditLog.entity, filters.entity));
  if (filters.entityId) conds.push(eq(adminAuditLog.entityId, filters.entityId));
  if (filters.action) {
    conds.push(
      filters.action.endsWith(".*")
        ? sql`${adminAuditLog.action} like ${escapeLike(filters.action.slice(0, -1)) + "%"}`
        : eq(adminAuditLog.action, filters.action),
    );
  }
  const from = filters.from ? istStart(filters.from) : null;
  if (from) conds.push(gte(adminAuditLog.createdAt, from));
  const to = filters.to ? istStart(filters.to) : null;
  if (to) conds.push(lt(adminAuditLog.createdAt, new Date(to.getTime() + 24 * 3600_000)));
  return conds.length ? and(...conds) : undefined;
}

const selection = {
  id: adminAuditLog.id,
  createdAt: adminAuditLog.createdAt,
  actorId: adminAuditLog.actorId,
  actorName: user.name,
  actorEmail: user.email,
  action: adminAuditLog.action,
  entity: adminAuditLog.entity,
  entityId: adminAuditLog.entityId,
  diff: adminAuditLog.diff,
  ip: adminAuditLog.ip,
};

export async function listAuditLog(
  db: DbClient,
  viewer: { role: string },
  filters: AuditFilters & { page?: number; pageSize?: number } = {},
): Promise<AuditPage> {
  assertCan(viewer.role, "audit:view");
  const pageSize = Math.min(Math.max(filters.pageSize ?? AUDIT_PAGE_SIZE, 1), 200);
  const cond = where(filters);
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adminAuditLog)
    .leftJoin(user, eq(adminAuditLog.actorId, user.id))
    .where(cond);
  const pageCount = Math.max(1, Math.ceil(n / pageSize));
  const page = Math.min(Math.max(1, Math.trunc(filters.page ?? 1) || 1), pageCount);
  const items = await db
    .select(selection)
    .from(adminAuditLog)
    .leftJoin(user, eq(adminAuditLog.actorId, user.id))
    .where(cond)
    .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { items, total: n, page, pageCount, pageSize };
}

export interface AuditFacets {
  entities: string[];
  actions: string[];
  actors: { id: string; label: string }[];
}

/** Values for the filter dropdowns. */
export async function getAuditFacets(db: DbClient, viewer: { role: string }): Promise<AuditFacets> {
  assertCan(viewer.role, "audit:view");
  const [entities, actions, actors] = await Promise.all([
    db.selectDistinct({ v: adminAuditLog.entity }).from(adminAuditLog).orderBy(adminAuditLog.entity),
    db.selectDistinct({ v: adminAuditLog.action }).from(adminAuditLog).orderBy(adminAuditLog.action),
    db
      .selectDistinct({ id: user.id, name: user.name, email: user.email })
      .from(adminAuditLog)
      .innerJoin(user, eq(adminAuditLog.actorId, user.id))
      .orderBy(user.name),
  ]);
  return {
    entities: entities.map((e) => e.v),
    actions: actions.map((a) => a.v),
    actors: actors.map((a) => ({ id: a.id, label: `${a.name} (${a.email})` })),
  };
}

/** Spreadsheets run text starting with = + - @ as formulas; prefix such cells with an apostrophe. */
function csvCell(value: string): string {
  let s = value;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function auditCsv(rows: readonly AuditRow[]): string {
  const header = ["Time (UTC)", "Actor", "Actor email", "Action", "Entity", "Entity id", "IP", "Changes"];
  const lines = rows.map((r) =>
    [
      r.createdAt.toISOString(),
      r.actorName ?? (r.actorId ? "(deleted user)" : "system"),
      r.actorEmail ?? "",
      r.action,
      r.entity,
      r.entityId ?? "",
      r.ip ?? "",
      r.diff === null || r.diff === undefined ? "" : JSON.stringify(r.diff),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}

/** Rows for a CSV download of the filtered log (newest first, capped at `AUDIT_EXPORT_MAX`). */
export async function exportAuditLog(
  db: DbClient,
  viewer: { role: string },
  filters: AuditFilters = {},
): Promise<{ rows: AuditRow[]; truncated: boolean }> {
  assertCan(viewer.role, "audit:view");
  const rows = await db
    .select(selection)
    .from(adminAuditLog)
    .leftJoin(user, eq(adminAuditLog.actorId, user.id))
    .where(where(filters))
    .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
    .limit(AUDIT_EXPORT_MAX + 1);
  return { rows: rows.slice(0, AUDIT_EXPORT_MAX), truncated: rows.length > AUDIT_EXPORT_MAX };
}
