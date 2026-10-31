import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PolicyEditor } from "@/components/admin/policies/PolicyEditor";
import { Badge, PageHeader } from "@/components/admin/ui";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getPolicyEditor, istToday, POLICY_TITLES } from "@/server/services/admin/policies";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Policy" };

const istDate = (d: Date | null) => (d ? istToday(d) : null);

export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await requireAdmin("policy:view");
  const { slug } = await params;
  const data = await getPolicyEditor(getDb(), slug);
  if (!data) notFound();
  return (
    <>
      <PageHeader
        back={{ href: "/admin/policies", label: "Policies" }}
        title={data.live?.title ?? data.draft.title ?? POLICY_TITLES[data.slug]}
        description={`Shown on the storefront at /policies/${data.slug}.`}
        badges={
          data.published ? (
            <Badge tone="success">Live · version {data.liveVersion}</Badge>
          ) : (
            <Badge tone="warning">Not published</Badge>
          )
        }
      />
      <PolicyEditor
        // Remount with fresh values after every save / publish / restore.
        key={`${data.draft.version}:${data.draft.saved}:${data.draft.bodyMd.length}:${data.draft.title}:${data.liveVersion}`}
        slug={data.slug}
        published={data.published}
        liveVersion={data.liveVersion}
        draft={data.draft}
        problemCount={data.problems.length}
        history={data.history.map((h) => ({
          version: h.version,
          title: h.title,
          bodyMd: h.bodyMd,
          effectiveDate: istDate(h.effectiveAt),
          publishedByName: h.publishedByName,
          isLive: h.isLive,
        }))}
        today={istToday()}
        canEdit={can(session.user.role, "policy:edit")}
        canPublish={can(session.user.role, "policy:publish")}
      />
    </>
  );
}
