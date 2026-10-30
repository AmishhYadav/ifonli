import type { Metadata } from "next";

import { InventoryTable } from "@/components/admin/inventory/InventoryTable";
import { PageHeader } from "@/components/admin/ui";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listInventory, type InventoryFilter } from "@/server/services/admin/inventory";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdmin("inventory:view");
  const sp = await searchParams;
  const raw = Array.isArray(sp.filter) ? sp.filter[0] : sp.filter;
  const filter: InventoryFilter = raw === "low" || raw === "out" ? raw : "all";
  const rows = await listInventory(getDb(), { filter });

  return (
    <>
      <PageHeader
        title="Inventory"
        description="On hand, reserved by open checkouts, and available to sell. Every change is written to the stock ledger."
      />
      <InventoryTable
        rows={rows}
        filter={filter}
        canAdjust={can(session.user.role, "inventory:adjust")}
      />
    </>
  );
}
