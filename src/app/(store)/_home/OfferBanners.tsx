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
    <div className="relative flex min-h-40 items-center gap-5 overflow-hidden rounded-card bg-accent p-6 text-on-accent shadow-card sm:p-8">
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
 * `home_offer` banners: global ones always, vibe-specific ones only while that vibe is active (CSS). With no
 * vibe-specific banner there is one list; otherwise each vibe gets its own (global + its own) inside a `[data-v]`
 * wrapper, so the last-row rule is right for whichever vibe is showing.
 */
export async function OfferBanners() {
  const perVibe = await Promise.all(
    VIBES.map((vibe) => getActiveBanners({ placement: "home_offer", vibe })),
  );
  const lists = VIBES.map((vibe, i) => ({ vibe, banners: perVibe[i] ?? [] }));
  const global = (perVibe[0] ?? []).filter((b) => b.vibeSlug === null);
  const hasSpecific = lists.some((l) => l.banners.some((b) => b.vibeSlug !== null));

  if (global.length === 0 && !hasSpecific) return null;
  return (
    <section aria-label="Offers" className="below-fold mx-auto mt-16 max-w-[1440px] px-4 sm:px-6">
      {hasSpecific ? (
        lists
          .filter((l): l is { vibe: Vibe; banners: ActiveBanner[] } => l.banners.length > 0)
          .map(({ vibe, banners }) => (
            <div key={vibe} data-v={vibe}>
              <BannerGrid banners={banners} />
            </div>
          ))
      ) : (
        <BannerGrid banners={global} />
      )}
    </section>
  );
}
