"use client";

import { AlertTriangle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/admin/ui";
import type { FeaturedAdminData } from "@/server/services/admin/featured";

import { BannersManager, type BannerView, type VibeOption } from "./BannersManager";
import { SlotsEditor } from "./SlotsEditor";
import type { ContentTab } from "./tabs";

/** Admin > Content: banners, the announcement bar, featured sets and hero tiles. The tab lives in `?tab=`. */
export function ContentTabs({
  initialTab,
  offers,
  announcements,
  vibes,
  featured,
  canEdit,
}: {
  initialTab: ContentTab;
  offers: BannerView[];
  announcements: BannerView[];
  vibes: VibeOption[];
  featured: FeaturedAdminData;
  canEdit: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = React.useState<ContentTab>(initialTab);
  const heroWarnings = featured.vibes.filter((v) => v.heroStats.warning).length;

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => {
        setTab(next as ContentTab);
        router.replace(`${pathname}?tab=${next}`, { scroll: false });
      }}
    >
      <TabsList>
        <TabsTrigger value="offers">Home banners</TabsTrigger>
        <TabsTrigger value="announcement">Announcement bar</TabsTrigger>
        <TabsTrigger value="featured">Featured sets</TabsTrigger>
        <TabsTrigger value="hero">
          Hero tiles
          {heroWarnings > 0 ? (
            <span
              className="inline-flex items-center gap-0.5 text-admin-warning"
              title={`${heroWarnings} vibes need more cutouts`}
            >
              <AlertTriangle className="size-3.5" aria-hidden />
              <span className="sr-only">{heroWarnings} vibes need more cutouts</span>
              <span aria-hidden>{heroWarnings}</span>
            </span>
          ) : null}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="offers">
        <BannersManager placement="home_offer" banners={offers} vibes={vibes} canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="announcement">
        <BannersManager
          placement="announcement"
          banners={announcements}
          vibes={vibes}
          canEdit={canEdit}
        />
      </TabsContent>
      <TabsContent value="featured">
        <SlotsEditor
          vibes={featured.vibes}
          candidates={featured.candidates}
          placement="home_featured"
          canEdit={canEdit}
        />
      </TabsContent>
      <TabsContent value="hero">
        <SlotsEditor
          vibes={featured.vibes}
          candidates={featured.candidates}
          placement="hero_tiles"
          canEdit={canEdit}
        />
      </TabsContent>
    </Tabs>
  );
}
