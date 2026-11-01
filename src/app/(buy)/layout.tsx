import { BuyFooter } from "@/components/store/footer/BuyFooter";
import { BuyHeader } from "@/components/store/header/BuyHeader";
import { OfflineNotice } from "@/components/store/OfflineNotice";
import { AnalyticsMount } from "@/features/analytics/AnalyticsMount";
import { DEFAULT_VIBE_CYCLE } from "@/features/vibe/config";
import { getVibeSettings } from "@/server/cache/settings";

/**
 * Cart, checkout, confirmation and tracking: palette only (`data-vibe-scope="buy"` resets shape, type and
 * texture to the plain base, so forms, prices and small text stay readable in every theme). The header keeps the
 * brand (the hand, which still switches the theme, and the wordmark) but no promo bar or nav pills; only
 * /checkout gets the minimal "Secure checkout" cue, so nothing distracts from paying (plan section 10). Page
 * headings opt back into the theme's display font with `buy-display` (see styles/vibe.css).
 */
export default async function BuyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cycle = await getVibeSettings().then(
    (s) => s.cycle,
    () => [...DEFAULT_VIBE_CYCLE],
  );
  return (
    <>
      <a
        href="#main"
        className="sr-only z-100 rounded-button bg-surface px-4 py-3 font-semibold text-ink shadow-card focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <BuyHeader cycle={cycle} />
      <OfflineNotice />
      <main id="main" tabIndex={-1} data-vibe-scope="buy" className="mx-auto min-h-[60dvh] max-w-5xl px-4 py-8 focus:outline-none sm:px-6">
        {children}
      </main>
      <BuyFooter />
      <AnalyticsMount />
    </>
  );
}
