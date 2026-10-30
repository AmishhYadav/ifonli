import "server-only";

import { adminAuditLog } from "@/server/db/schema";

import type { DbClient } from "./queries/shared";

export interface AuditEntry {
  /** Better Auth user id of the admin, or null for system actions. */
  actorId: string | null;
  /** Dot-separated verb, e.g. `product.update`, `stock.adjust`. */
  action: string;
  /** Table-ish noun, e.g. `product`, `variant`. */
  entity: string;
  entityId?: string | null;
  /** What changed: `{ field: { from, to } }` or a small summary object. Never put secrets here. */
  diff?: unknown;
  ip?: string | null;
}

/**
 * Appends a row to `admin_audit_log`. Pass the open transaction (`tx`) of the mutation so the audit
 * row commits or rolls back together with the change it describes. Every admin mutation calls it.
 */
export async function writeAudit(tx: DbClient, entry: AuditEntry): Promise<void> {
  await tx.insert(adminAuditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    diff: entry.diff ?? null,
    ip: entry.ip ?? null,
  });
}
