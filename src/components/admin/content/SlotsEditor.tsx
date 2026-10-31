"use client";

import { AlertTriangle, ArrowDown, ArrowUp, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { setFeaturedSlotsAction } from "@/app/admin/(app)/content/actions";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
} from "@/components/admin/ui";
import type { FeaturedPlacement, SlotProduct, VibeSlots } from "@/server/services/admin/featured";

const COPY: Record<FeaturedPlacement, { title: string; empty: string; max: number }> = {
  home_featured: {
    title: "Featured on the home page",
    empty: "Nothing curated: the newest products of this vibe are shown.",
    max: 16,
  },
  hero_tiles: {
    title: "Hero tiles",
    empty: "Nothing curated: the vibe's products that have a cutout are used.",
    max: 14,
  },
};

function SlotsCard({
  vibe,
  placement,
  candidates,
  canEdit,
}: {
  vibe: VibeSlots;
  placement: FeaturedPlacement;
  candidates: SlotProduct[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const saved = placement === "hero_tiles" ? vibe.hero : vibe.featured;
  const [list, setList] = React.useState<SlotProduct[]>(saved);
  const [adding, setAdding] = React.useState("");
  const [pending, start] = React.useTransition();
  const copy = COPY[placement];
  const dirty =
    JSON.stringify(list.map((p) => p.productId)) !== JSON.stringify(saved.map((p) => p.productId));
  const available = candidates.filter((c) => !list.some((l) => l.productId === c.productId));
  const stats = vibe.heroStats;
  const idBase = `${placement}-${vibe.slug}`;

  function move(i: number, dir: -1 | 1) {
    const next = [...list];
    const j = i + dir;
    if (!next[i] || !next[j]) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setList(next);
  }

  function save() {
    start(async () => {
      const res = await setFeaturedSlotsAction({
        vibeId: vibe.id,
        placement,
        productIds: list.map((p) => p.productId),
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${vibe.name}: ${copy.title.toLowerCase()} saved`);
      router.refresh();
    });
  }

  return (
    <Card data-testid={`slots-${idBase}`}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {vibe.name}
          {placement === "hero_tiles" ? (
            stats.warning ? (
              <Badge tone="warning" data-testid={`hero-warning-${vibe.slug}`}>
                <AlertTriangle aria-hidden /> {stats.effective} of {stats.needed} product cutouts
              </Badge>
            ) : (
              <Badge tone="success">
                {stats.effective} of {stats.needed}+ product cutouts
              </Badge>
            )
          ) : null}
          {placement === "hero_tiles" && stats.usingFallback ? (
            <Badge tone="neutral">Using the vibe&apos;s products</Badge>
          ) : null}
          {placement === "hero_tiles" && stats.placeholderTiles > 0 ? (
            <Badge tone="warning">{stats.placeholderTiles} placeholder</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {placement === "hero_tiles"
            ? "Products with a transparent cutout, in collage order (top first). At least 8 are needed for a full hero."
            : "Shown first in this vibe's featured row, in this order. The row shows 8."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {list.length === 0 ? (
          <p className="rounded-md border border-dashed border-admin-border-strong p-3 text-[13px] text-admin-ink-muted">
            {copy.empty}
          </p>
        ) : (
          <ol className="divide-y divide-admin-border rounded-lg border border-admin-border">
            {list.map((p, i) => (
              <li key={p.productId} className="flex items-center gap-2 px-3 py-1.5">
                <span className="tabular w-5 text-xs text-admin-ink-faint">{i + 1}</span>
                <span className="flex-1 truncate text-[13px]">{p.name}</span>
                {p.status !== "active" ? <Badge tone="warning">{p.status}</Badge> : null}
                {placement === "hero_tiles" && !p.hasCutout ? (
                  <Badge tone="danger">No cutout</Badge>
                ) : null}
                {placement === "hero_tiles" && p.placeholderCutout ? (
                  <Badge tone="warning">Placeholder cutout</Badge>
                ) : null}
                {canEdit ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${p.name} up in ${vibe.name} ${copy.title}`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${p.name} down in ${vibe.name} ${copy.title}`}
                      disabled={i === list.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${p.name} from ${vibe.name} ${copy.title}`}
                      onClick={() => setList(list.filter((x) => x.productId !== p.productId))}
                    >
                      <X aria-hidden />
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label={`Add product to ${vibe.name} ${copy.title}`}
              className="w-72 max-w-full"
              value={adding}
              onValueChange={(id) => {
                const p = available.find((x) => x.productId === id);
                if (p && list.length < copy.max) setList([...list, p]);
                setAdding("");
              }}
              options={available.map((p) => ({
                value: p.productId,
                label:
                  placement === "hero_tiles" && !p.hasCutout ? `${p.name} (no cutout)` : p.name,
              }))}
              placeholder={
                list.length >= copy.max
                  ? `Up to ${copy.max}`
                  : available.length
                    ? "Add a product…"
                    : "All products added"
              }
              disabled={available.length === 0 || list.length >= copy.max}
            />
            <Button size="sm" disabled={!dirty} loading={pending} onClick={save}>
              Save {placement === "hero_tiles" ? "tiles" : "order"}
            </Button>
            {dirty ? (
              <Button variant="ghost" size="sm" onClick={() => setList(saved)}>
                Reset
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function SlotsEditor({
  vibes,
  candidates,
  placement,
  canEdit,
}: {
  vibes: VibeSlots[];
  candidates: SlotProduct[];
  placement: FeaturedPlacement;
  canEdit: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      {vibes.map((v) => (
        <SlotsCard
          // Remount with fresh values after every save.
          key={`${v.id}:${(placement === "hero_tiles" ? v.hero : v.featured).map((p) => p.productId).join(",")}`}
          vibe={v}
          placement={placement}
          candidates={candidates}
          canEdit={canEdit}
        />
      ))}
    </div>
  );
}
