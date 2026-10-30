import type { ReactNode } from "react";

import "@/styles/store.css";

import { Footer } from "./footer/Footer";
import { AnnouncementBar } from "./header/AnnouncementBar";
import { Header } from "./header/Header";

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
      <AnnouncementBar />
      <Header />
      <main id="main" className="min-h-[60dvh]">
        {children}
      </main>
      <Footer />
    </>
  );
}
