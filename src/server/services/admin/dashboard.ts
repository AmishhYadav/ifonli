import "server-only";

import { count, desc, eq } from "drizzle-orm";

import { adminAuditLog, products, user } from "@/server/db/schema";
import { listLowStock } from "@/server/services/inventory";
import type { DbClient } from "@/server/services/queries/shared";

export interface DashboardStats {
  products: { active: number; draft: number; archived: number };
  lowStock: number;
  outOfStock: number;
  recentActivity: {
    id: string;
    action: string;
    entity: string;
    entityId: string | null;
    actorName: string | null;
    createdAt: Date;
  }[];
}

export async function getDashboardStats(
  db: DbClient,
  opts: { withActivity: boolean },
): Promise<DashboardStats> {
  const [statusRows, low, activity] = await Promise.all([
    db.select({ status: products.status, n: count() }).from(products).groupBy(products.status),
    listLowStock(db),
    opts.withActivity
      ? db
          .select({
            id: adminAuditLog.id,
            action: adminAuditLog.action,
            entity: adminAuditLog.entity,
            entityId: adminAuditLog.entityId,
            actorName: user.name,
            createdAt: adminAuditLog.createdAt,
          })
          .from(adminAuditLog)
          .leftJoin(user, eq(adminAuditLog.actorId, user.id))
          .orderBy(desc(adminAuditLog.createdAt))
          .limit(8)
      : Promise.resolve([]),
  ]);
  const byStatus = new Map(statusRows.map((r) => [r.status, r.n]));
  return {
    products: {
      active: byStatus.get("active") ?? 0,
      draft: byStatus.get("draft") ?? 0,
      archived: byStatus.get("archived") ?? 0,
    },
    lowStock: low.filter((r) => r.available > 0).length,
    outOfStock: low.filter((r) => r.available <= 0).length,
    recentActivity: activity,
  };
}
