import Image from "next/image";
import Link from "next/link";

import { VIBES, isVibe } from "@/features/vibe/config";
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
    // A vibe-specific banner wears its own vibe's colours; a global one takes the home page's neutral ones.
    <div
      data-vibe={isVibe(banner.vibeSlug) ? banner.vibeSlug : undefined}
      className="relative flex min-h-40 items-center gap-5 overflow-hidden rounded-card bg-accent p-6 text-on-accent shadow-card sm:p-8"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="font-display text-2xl leading-tight sm:text-3xl">{banner.title}</h3>
        {banner.body ? <p className="text-base">{banner.body}</p> : null}
      </div>
      {src ? (
        // The banner art ships with a hard white frame baked in; the thumb crops it away (scale inside a rounded,
        // clipped box) and sits on a soft shadow instead of an outline.
        <span className="relative hidden size-32 flex-none overflow-hidden rounded-card shadow-card sm:block">
          <Image src={src} alt="" fill sizes="128px" className="scale-[1.14] object-cover" />
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

/**
 * Two columns from `md`. A lone last banner of an odd count spans the row, so the grid never ends on a hole.
 * Banners are `li`s of their own list, so the odd-count test sees exactly the ones that are shown.
 */
function BannerGrid({ banners }: { banners: ActiveBanner[] }) {
  const odd = banners.length % 2 === 1;
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {banners.map((banner, i) => (
        <li key={banner.id} className={odd && i === banners.length - 1 ? "md:col-span-2" : undefined}>
          <Banner banner={banner} />
        </li>
      ))}
    </ul>
  );
}

/**
 * `home_offer` banners: the home page is every vibe at once, so it shows the global banners and each vibe's own, once
 * each, the vibe-specific ones in their own colours.
 */
export async function OfferBanners() {
  const perVibe = await Promise.all(
    VIBES.map((vibe) => getActiveBanners({ placement: "home_offer", vibe })),
  );
  const banners = [...new Map(perVibe.flat().map((b) => [b.id, b])).values()];

  if (banners.length === 0) return null;
  return (
    <section aria-label="Offers" className="below-fold mx-auto mt-16 max-w-[1440px] px-4 sm:px-6">
      <BannerGrid banners={banners} />
    </section>
  );
}
