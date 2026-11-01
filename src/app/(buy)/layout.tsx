import { BuyFooter } from "@/components/store/footer/BuyFooter";
import { BuyHeader } from "@/components/store/header/BuyHeader";
import { OfflineNotice } from "@/components/store/OfflineNotice";
import { AnalyticsMount } from "@/features/analytics/AnalyticsMount";

/**
 * Cart, checkout, confirmation and tracking: palette only (`data-vibe-scope="buy"` resets shape, type and
 * texture to the plain base). Plain header with no hand button; only /checkout gets the minimal "Secure
 * checkout" one, so nothing distracts from paying (plan section 10).
 */
export default function BuyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-100 rounded-button bg-surface px-4 py-3 font-semibold text-ink shadow-card focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <BuyHeader />
      <OfflineNotice />
      <main id="main" tabIndex={-1} data-vibe-scope="buy" className="mx-auto min-h-[60dvh] max-w-5xl px-4 py-8 focus:outline-none sm:px-6">
        {children}
      </main>
      <BuyFooter />
      <AnalyticsMount />
    </>
  );
}
