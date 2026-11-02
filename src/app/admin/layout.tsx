import type { Metadata } from "next";

import { Toaster } from "@/components/admin/ui";

import "@/styles/admin.css";

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
    <div data-admin className="min-h-dvh">
      {children}
      <Toaster />
    </div>
  );
}
