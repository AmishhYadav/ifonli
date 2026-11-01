import Link from "next/link";

import { getActiveBanners } from "@/server/cache/content";

/** Slim site-wide notice from the `announcement` banners (first one only). Renders nothing when there is none. */
export async function AnnouncementBar() {
  let banners: Awaited<ReturnType<typeof getActiveBanners>> = [];
  try {
    banners = await getActiveBanners({ placement: "announcement" });
  } catch (error) {
    console.error("AnnouncementBar: could not load banners", error);
  }
  const banner = banners[0];
  if (!banner) return null;

  const text = (
    <>
      <span className="font-semibold">{banner.title}</span>
      {banner.body ? <span className="hidden sm:inline"> {banner.body}</span> : null}
    </>
  );
  return (
    <div data-testid="announcement-bar" className="bg-[color-mix(in_srgb,var(--accent)_10%,var(--bg))] text-ink">
      <p className="mx-auto flex min-h-9 max-w-[1440px] items-center justify-center px-4 py-1.5 text-center text-xs sm:px-6 sm:text-sm">
        {banner.link ? (
          <Link href={banner.link} className="underline decoration-[color-mix(in_srgb,currentColor_40%,transparent)] underline-offset-4 hover:no-underline">
            {text}
          </Link>
        ) : (
          <span>{text}</span>
        )}
      </p>
    </div>
  );
}
