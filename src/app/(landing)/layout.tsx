import "@/styles/landing.css";

import { AnalyticsMount } from "@/features/analytics/AnalyticsMount";
import { TopBar } from "@/features/landing/TopBar";

/**
 * The scroll-through landing page at `/`: no store header or footer, just a slim top bar with the wordmark
 * and "Skip intro". The root layout (vibe head script, fonts) still wraps it.
 */
export default function LandingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-100 rounded-button border-token bg-surface px-4 py-3 font-semibold text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <TopBar />
      <main id="main" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
      <AnalyticsMount />
    </>
  );
}
