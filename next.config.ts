import type { NextConfig } from "next";

import { buildSecurityHeaders, NO_REFERRER_SOURCES } from "./src/lib/security/headers";

const production = process.env.NODE_ENV === "production";
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

/** next/image remote pattern for a Supabase Storage project URL (public buckets), or null if unset/invalid. */
function supabaseImagePattern(
  value: string | undefined,
): NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>[number] | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return {
      protocol: url.protocol === "https:" ? "https" : "http",
      hostname: url.hostname,
      ...(url.port ? { port: url.port } : {}),
      pathname: "/storage/v1/object/public/**",
    };
  } catch {
    return null;
  }
}

const productionSupabase = supabaseImagePattern(supabaseUrl);

const nextConfig: NextConfig = {
  // Lets parallel local dev servers / builds use separate output dirs (NEXT_DIST_DIR=.next-a).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Next.js 16: top-level `cacheComponents` (replaces experimental.ppr / dynamicIO).
  cacheComponents: true,
  // Do not advertise the framework.
  poweredByHeader: false,
  images: {
    remotePatterns: [
      // Local Supabase Storage (public buckets).
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "54321",
        pathname: "/storage/v1/object/public/**",
      },
      // The configured Supabase project (production: https://<ref>.supabase.co).
      ...(productionSupabase ? [productionSupabase] : []),
    ],
    // Next 16 blocks local-IP image sources by default; only allow them in development.
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== "production",
  },
  partialPrefetching: true,
  // `next dev` logs every Server Function call with its arguments, which would print passwords and sign-in codes.
  logging: { serverFunctions: false },
  async headers() {
    const base = buildSecurityHeaders({
      production,
      mode: process.env.CSP_MODE,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
      supabaseUrl,
      ga4Id: process.env.NEXT_PUBLIC_GA4_ID,
    });
    return [
      { source: "/:path*", headers: base },
      // Files in public/ are served `max-age=0` by default. Their names are not hashed, so a changed
      // file must still reach people: fonts get a month (plus a day of serving stale while the CDN
      // refetches) and are deliberately not `immutable`; icons, vibe art and placeholders a day.
      {
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=2592000, stale-while-revalidate=86400" }],
      },
      {
        source: "/(icons|vibe|placeholders)/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
      // Order pages carry guest order tokens (?t=) and personal data: send no Referer at all.
      ...NO_REFERRER_SOURCES.map((source) => ({
        source,
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      })),
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
