import type { Metadata } from "next";
import { Suspense } from "react";

import { BODY_FONT_FILE, DEFAULT_VIBE } from "@/features/vibe/config";
import { VibeFilters } from "@/features/vibe/VibeFilters";
import { VibeHeadScript } from "@/features/vibe/VibeHeadScript";
import { VibeUrlSync } from "@/features/vibe/VibeUrlSync";

import "./globals.css";

export const metadata: Metadata = {
  title: "IfOnli",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // data-vibe here is only the no-JS fallback; the head script sets the real vibe before first paint.
    <html lang="en-IN" data-vibe={DEFAULT_VIBE} suppressHydrationWarning>
      <head>
        <VibeHeadScript />
        <link
          rel="preload"
          href={BODY_FONT_FILE}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <VibeFilters />
        {children}
        <div id="vibe-live" role="status" aria-live="polite" className="sr-only" />
        <Suspense fallback={null}>
          <VibeUrlSync />
        </Suspense>
      </body>
    </html>
  );
}
