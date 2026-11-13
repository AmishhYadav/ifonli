import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from "next/font/google";

import { Ambient } from "@/components/admin/shell/Ambient";
import { PointerFx } from "@/components/admin/shell/PointerFx";
import { Toaster } from "@/components/admin/ui";

import "@/styles/admin.css";

/**
 * Admin typefaces. `next/font` self-hosts them under /_next/static on this origin (the CSP allows
 * `font-src 'self'`), and because they are loaded here and nowhere else, storefront pages never
 * download them. Display: Bricolage Grotesque (headings, big numbers). UI: Instrument Sans.
 * Mono: JetBrains Mono (order refs, SKUs, money in code-like cells).
 */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--nf-admin-display",
});
const sans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--nf-admin-sans",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--nf-admin-mono",
});

/**
 * The admin is session-gated and fully dynamic, so it is exempt from instant-navigation validation
 * (a static shell would only ever be a spinner). The storefront routes keep validating.
 */
export const instant = false;

export const metadata: Metadata = {
  title: { default: "IfOnli Admin", template: "%s · IfOnli Admin" },
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Admin root: never themed. The storefront head script still sets `<html data-vibe>`, so everything
 * here lives under `data-admin`, which `styles/admin.css` uses to neutralise the vibe (texture,
 * cursor, display fonts, border colour). No session read here, so the shell can prerender; the
 * session is read in `(app)/layout.tsx` behind Suspense.
 */
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-admin
      className={`${display.variable} ${sans.variable} ${mono.variable} relative min-h-dvh`}
    >
      <Ambient />
      <PointerFx />
      <div className="relative z-[1] min-h-dvh">{children}</div>
      <Toaster />
    </div>
  );
}
