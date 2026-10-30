import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Hammer } from "lucide-react";

import { navItemBySlug } from "@/components/admin/nav";
import { EmptyState, PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/session";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Coming soon" };

/** Placeholder for admin modules that are not built yet (see `components/admin/nav.ts`). */
export default async function ComingSoonPage({ params }: { params: Promise<{ module: string }> }) {
  const { module: slug } = await params;
  const item = navItemBySlug(slug);
  if (!item || !slug || item.built) notFound();
  await requireAdmin(item.permission);

  return (
    <>
      <PageHeader title={item.label} />
      <EmptyState
        icon={<Hammer />}
        title="Coming soon"
        description={item.blurb || "This module is not built yet."}
      />
    </>
  );
}
