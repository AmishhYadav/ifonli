import Image from "next/image";

import { cn } from "@/lib/cn";
import type { HeroTile } from "@/server/services/catalog";
import { imageProps } from "@/server/services/media";

const ROTATIONS = ["-rotate-6", "rotate-3", "-rotate-2"] as const;

/**
 * Three product cutouts fanned over an accent disc: the little "cover" used on vibe cards and the vibe
 * collection header. Decorative (the product names live on the cards below), so it is hidden from assistive tech.
 */
export function TileFan({
  tiles,
  size = "md",
  className,
}: {
  tiles: HeroTile[];
  /** `card`: a compact fan on a phone (a side cover), the `md` fan from `sm` up. */
  size?: "md" | "lg" | "card";
  className?: string;
}) {
  const big = size === "lg";
  const card = size === "card";
  return (
    <div
      aria-hidden="true"
      className={cn("relative flex items-center justify-center", big ? "h-56 w-80" : card ? "h-24 sm:h-32" : "h-32", className)}
    >
      <span
        className={cn(
          "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color-mix(in_srgb,var(--surface)_55%,transparent)]",
          big ? "size-52" : card ? "size-20 sm:size-28" : "size-28",
        )}
      />
      {tiles.slice(0, 3).map((tile, i) => {
        let src: string | null = null;
        try {
          src = imageProps(tile.cutout).src;
        } catch {
          src = null;
        }
        if (!src) return null;
        return (
          <span
            key={tile.productId}
            className={cn(
              "relative rounded-card bg-surface shadow-card",
              big ? "-mx-4 size-36" : card ? "-mx-2 size-12 sm:-mx-3 sm:size-20" : "-mx-3 size-20",
              ROTATIONS[i % ROTATIONS.length],
            )}
          >
            <Image src={src} alt="" fill sizes={big ? "144px" : card ? "(min-width: 640px) 80px, 48px" : "80px"} className="object-contain p-2" />
          </span>
        );
      })}
    </div>
  );
}
