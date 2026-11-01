import { Suspense, type ReactNode } from "react";

import "@/styles/store.css";
import "@/styles/motion.css";

import { WishlistAccountSync } from "@/features/wishlist/WishlistAccountSync";
import { AnalyticsMount } from "@/features/analytics/AnalyticsMount";

import { Footer } from "./footer/Footer";
import { AnnouncementBar } from "./header/AnnouncementBar";
import { Header } from "./header/Header";
import { OfflineNotice } from "./OfflineNotice";

/** Skip link, announcement bar, header, `<main id="main">` and footer: the frame of every discovery page. */
export function StoreChrome({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-100 rounded-button border-token bg-surface px-4 py-3 font-semibold text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <OfflineNotice />
      <AnnouncementBar />
      <Header />
      <main id="main" tabIndex={-1} className="min-h-[60dvh] focus:outline-none">
        {children}
      </main>
      <Footer />
      <Suspense fallback={null}>
        <WishlistAccountSync />
      </Suspense>
      <AnalyticsMount />
    </>
  );
}
