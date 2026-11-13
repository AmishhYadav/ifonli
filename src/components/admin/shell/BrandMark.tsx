import Image from "next/image";

import { cn } from "@/components/admin/ui/cn";

const SIZES = {
  sm: { px: 32, src: "/brand/ifonli-logo-128.png", name: "text-[17px]", tag: "text-[10px]" },
  md: { px: 44, src: "/brand/ifonli-logo-128.png", name: "text-xl", tag: "text-[11px]" },
  hero: { px: 112, src: "/brand/ifonli-logo-256.png", name: "text-3xl", tag: "text-xs" },
} as const;

/**
 * The IfOnli badge (the real logo) beside the "IfOnli" wordmark and a small "Admin" tag. The badge
 * bobs gently, breathes a soft peach glow and wiggles on hover (all stopped under reduced motion,
 * see admin.css). The image is decorative (alt="") because the wordmark text is right beside it.
 * `hero` stacks the mark above the name for the sign-in screen.
 */
export function BrandMark({
  size = "sm",
  stacked,
  className,
}: {
  size?: keyof typeof SIZES;
  stacked?: boolean;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 text-admin-ink",
        stacked && "flex-col gap-4 text-center",
        size === "hero" ? "admin-brand-hero" : "admin-brand-link",
        className,
      )}
    >
      <span className="admin-brand-badge">
        <span className="admin-brand-bob">
          <Image
            src={s.src}
            alt=""
            width={s.px}
            height={s.px}
            unoptimized
            priority={size === "hero"}
            className="admin-brand-img"
            style={{ width: s.px, height: s.px }}
          />
        </span>
      </span>
      <span className={cn("flex items-center gap-2", stacked && "flex-col gap-1.5")}>
        <span
          className={cn("font-admin-display leading-none font-bold tracking-tight", s.name)}
        >
          IfOnli
        </span>
        <span
          className={cn(
            "rounded-full border border-admin-border bg-admin-primary-soft px-2 py-0.5 leading-none font-semibold tracking-wide text-admin-primary",
            s.tag,
          )}
        >
          Admin
        </span>
      </span>
    </span>
  );
}
