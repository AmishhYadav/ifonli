import type { Metadata } from "next";
import { Suspense } from "react";

import { ClientErrorReporter } from "@/components/monitoring/ClientErrorReporter";
import { ToastProvider } from "@/components/ui/Toast";
import { BODY_FONT_FILE, DEFAULT_VIBE, DEFAULT_VIBE_CYCLE } from "@/features/vibe/config";
import { VibeFilters } from "@/features/vibe/VibeFilters";
import { VibeHeadScript } from "@/features/vibe/VibeHeadScript";
import { InAppHistoryTracker } from "@/features/navigation/InAppHistoryTracker";
import { MixMode } from "@/features/vibe/MixMode";
import { VibeUrlSync } from "@/features/vibe/VibeUrlSync";
import { siteUrl } from "@/lib/seo";
import { getVibeSettings, type VibeSettings } from "@/server/cache/settings";

import "./globals.css";

const ZOD_JITLESS_SCRIPT =
  "globalThis.__zod_globalConfig=Object.assign(globalThis.__zod_globalConfig||{},{jitless:true});";

const SHARE_DESCRIPTION =
  "Charms, 3D stickers and DIY kits in four moods: Mochi, Chaos Cabinet, Unapologetic and After the Dark. Made in India.";

/**
 * Site-wide share defaults. The share image comes from the root `opengraph-image.png` file convention, so a page
 * that sets no image of its own (it may still set its own title and description) shows the brand card.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "IfOnli", template: "%s | IfOnli" },
  description: SHARE_DESCRIPTION,
  applicationName: "IfOnli",
  openGraph: {
    type: "website",
    siteName: "IfOnli",
    locale: "en_IN",
    title: "IfOnli: charms, 3D stickers and DIY kits",
    description: SHARE_DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "IfOnli: charms, 3D stickers and DIY kits",
    description: SHARE_DESCRIPTION,
  },
  appleWebApp: { capable: true, title: "IfOnli", statusBarStyle: "default" },
};

/** The cached settings read must never take the whole site down: fall back to the built-in defaults. */
async function loadVibeSettings(): Promise<VibeSettings> {
  try {
    return await getVibeSettings();
  } catch (error) {
    console.error("RootLayout: could not read vibe settings, using defaults", error);
    return { cycle: [...DEFAULT_VIBE_CYCLE], defaultVibe: DEFAULT_VIBE, heroEnabled: true };
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { cycle, defaultVibe } = await loadVibeSettings();
  return (
    // data-vibe here is only the no-JS fallback; the head script sets the real vibe before first paint.
    <html lang="en-IN" data-vibe={DEFAULT_VIBE} suppressHydrationWarning>
      <head>
        {/*
          Zod adopts globalThis.__zod_globalConfig when it loads. jitless stops its `new Function` probe,
          which a CSP without 'unsafe-eval' reports as a violation (D-SEC-1). This must run before any
          bundle builds a schema, so it is an inline script ahead of everything else.
        */}
        <script dangerouslySetInnerHTML={{ __html: ZOD_JITLESS_SCRIPT }} />
        <VibeHeadScript cycle={cycle} defaultVibe={defaultVibe} />
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
        <ClientErrorReporter />
        <ToastProvider>{children}</ToastProvider>
        <div id="vibe-live" role="status" aria-live="polite" className="sr-only" />
        <Suspense fallback={null}>
          <MixMode />
          <VibeUrlSync />
          <InAppHistoryTracker />
        </Suspense>
      </body>
    </html>
  );
}
