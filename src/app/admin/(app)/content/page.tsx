import type { Metadata } from "next";

import { ContentTabs } from "@/components/admin/content/ContentTabs";
import { CONTENT_TABS, type ContentTab } from "@/components/admin/content/tabs";
import type { BannerView } from "@/components/admin/content/BannersManager";
import { PageHeader } from "@/components/admin/ui";
import { can } from "@/server/auth/permissions";
import { requireAdmin } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listBanners, liveAnnouncementId, type AdminBanner } from "@/server/services/admin/banners";
import { getFeaturedAdmin } from "@/server/services/admin/featured";
import { resolveImageUrl } from "@/server/services/media";
import { vibes } from "@/server/db/schema";
import { asc } from "drizzle-orm";

/** Session-gated and dynamic: exempt from instant-navigation validation (see admin/layout.tsx). */
export const instant = false;

export const metadata: Metadata = { title: "Content" };

function view(b: AdminBanner, showingNowId: string | null): BannerView {
  let imageUrl: string | null = null;
  if (b.imagePath) {
    try {
      imageUrl = resolveImageUrl(b.imagePath);
    } catch {
      imageUrl = null;
    }
  }
  return {
    id: b.id,
    placement: b.placement,
    vibeId: b.vibeId,
    vibeName: b.vibeName,
    title: b.title,
    body: b.body,
    imagePath: b.imagePath,
    imageUrl,
    link: b.link,
    startsAt: b.startsAt?.toISOString() ?? null,
    endsAt: b.endsAt?.toISOString() ?? null,
    active: b.active,
    state: b.state,
    showingNow: b.id === showingNowId,
  };
}

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdmin("content:view");
  const sp = await searchParams;
  const raw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: ContentTab = (CONTENT_TABS as readonly string[]).includes(raw ?? "") ? (raw as ContentTab) : "offers";

  const db = getDb();
  const [all, featured, vibeRows] = await Promise.all([
    listBanners(db),
    getFeaturedAdmin(db),
    db.select({ id: vibes.id, name: vibes.name }).from(vibes).orderBy(asc(vibes.sort), asc(vibes.name)),
  ]);
  const showingNow = liveAnnouncementId(all);
  return (
    <>
      <PageHeader
        title="Content"
        description="Banners, the announcement bar, and which products lead each vibe on the home page and in the hero."
      />
      <ContentTabs
        initialTab={tab}
        offers={all.filter((b) => b.placement === "home_offer").map((b) => view(b, showingNow))}
        announcements={all.filter((b) => b.placement === "announcement").map((b) => view(b, showingNow))}
        vibes={vibeRows}
        featured={featured}
        canEdit={can(session.user.role, "content:manage")}
      />
    </>
  );
}
