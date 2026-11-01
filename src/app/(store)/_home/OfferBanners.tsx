import Image from "next/image";
import Link from "next/link";

import { VIBES, type Vibe } from "@/features/vibe/config";
import { getActiveBanners } from "@/server/cache/content";
import type { ActiveBanner } from "@/server/services/content";
import { resolveImageUrl } from "@/server/services/media";

function Banner({ banner }: { banner: ActiveBanner }) {
  let src: string | null = null;
  if (banner.imagePath) {
    try {
      src = resolveImageUrl(banner.imagePath);
    } catch {
      src = null;
    }
  }
  const body = (
    <div className="relative flex min-h-40 items-center gap-5 overflow-hidden rounded-card border-token bg-accent p-6 text-on-accent shadow-card sm:p-8">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="font-display text-2xl leading-tight sm:text-3xl">{banner.title}</h3>
        {banner.body ? <p className="text-base">{banner.body}</p> : null}
      </div>
      {src ? (
        <span className="relative hidden size-32 flex-none sm:block">
          <Image src={src} alt="" fill sizes="128px" className="object-contain" />
        </span>
      ) : null}
    </div>
  );
  return banner.link ? (
    <Link href={banner.link} className="block rounded-card focus-visible:outline-offset-4">
      {body}
    </Link>
  ) : (
    body
  );
}

/** `home_offer` banners: global ones always, vibe-specific ones only while that vibe is active (CSS). */
export async function OfferBanners() {
  const perVibe = await Promise.all(
    VIBES.map((vibe) => getActiveBanners({ placement: "home_offer", vibe })),
  );
  const global = (perVibe[0] ?? []).filter((b) => b.vibeSlug === null);
  const specific = VIBES.map((vibe, i) => ({
    vibe,
    banners: (perVibe[i] ?? []).filter((b) => b.vibeSlug === vibe),
  })).filter((s): s is { vibe: Vibe; banners: ActiveBanner[] } => s.banners.length > 0);

  if (global.length === 0 && specific.length === 0) return null;
  return (
    <section aria-label="Offers" className="below-fold mx-auto mt-16 max-w-[1440px] px-4 sm:px-6">
      <ul className="grid gap-4 md:grid-cols-2">
        {global.map((banner) => (
          <li key={banner.id}>
            <Banner banner={banner} />
          </li>
        ))}
        {specific.map(({ vibe, banners }) => (
          <li key={vibe} data-v={vibe} className="contents">
            {banners.map((banner) => (
              <Banner key={banner.id} banner={banner} />
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
