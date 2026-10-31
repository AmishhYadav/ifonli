import type { Metadata } from "next";

import { FaqManager } from "@/components/admin/faq/FaqManager";
import { PageHeader } from "@/components/admin/ui";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listFaqsAdmin } from "@/server/services/admin/faq";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "FAQ" };

export default async function FaqPage() {
  const session = await requireAdmin("content:view");
  const faqs = await listFaqsAdmin(getDb());
  return (
    <>
      <PageHeader
        title="FAQ"
        description="Questions and answers on the Help page, grouped by category. Edits appear on the storefront straight away."
      />
      <FaqManager
        faqs={faqs.map((f) => ({
          id: f.id,
          category: f.category,
          question: f.question,
          answerMd: f.answerMd,
          published: f.published,
          problems: f.problems,
        }))}
        canEdit={can(session.user.role, "content:manage")}
      />
    </>
  );
}
