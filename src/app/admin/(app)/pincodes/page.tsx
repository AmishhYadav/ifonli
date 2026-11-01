import type { Metadata } from "next";

import { PincodeScreen } from "@/components/admin/pincodes/PincodeScreen";
import { PageHeader } from "@/components/admin/ui";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getPincodeFacets, getPincodeSummary, listPincodes } from "@/server/services/admin/pincodes";

import { pincodeFiltersFromParams } from "./filters";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Pincodes" };

export default async function PincodesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdmin("setting:view");
  const { page: pageNumber, ...filters } = pincodeFiltersFromParams(await searchParams);
  const db = getDb();
  const [page, facets, summary] = await Promise.all([
    listPincodes(db, filters, pageNumber),
    getPincodeFacets(db),
    getPincodeSummary(db),
  ]);
  return (
    <>
      <PageHeader
        title="Pincodes"
        description="Where we deliver and where cash on delivery is offered. Search, switch a pincode on or off, change a whole state or zone at once, or upload a CSV."
      />
      <PincodeScreen
        page={page}
        filters={filters}
        facets={facets}
        summary={summary}
        canEdit={can(session.user.role, "setting:update")}
      />
    </>
  );
}
