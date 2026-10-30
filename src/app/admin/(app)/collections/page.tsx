import type { Metadata } from "next";

import { CollectionsEditor } from "@/components/admin/collections/CollectionsEditor";
import { PageHeader } from "@/components/admin/ui";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getCollectionsAdmin } from "@/server/services/admin/collections";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Collections" };

export default async function CollectionsPage() {
  const session = await requireAdmin("collection:view");
  const data = await getCollectionsAdmin(getDb());
  return (
    <>
      <PageHeader
        title="Collections"
        description="The copy shown on each vibe and product type page, and which products lead each vibe."
      />
      <CollectionsEditor
        // Remount with fresh values after every save.
        key={JSON.stringify([
          data.vibes.map((v) => [v.id, v.featured.map((f) => f.productId)]),
          data.types.length,
        ])}
        vibes={data.vibes}
        types={data.types}
        canEdit={can(session.user.role, "collection:update")}
      />
    </>
  );
}
