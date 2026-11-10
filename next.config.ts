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
    // AVIF first, WebP as the fallback (the Accept header picks). Product art is small cut-outs and photos, so AVIF is a
    // clear saving; both are cached separately by the image optimizer.
    formats: ["image/avif", "image/webp"],
    // The widest slot on the site is the 1440 px page container (the PDP gallery asks for 680 px, cards for 25 vw),
    // so the 2048/3840 steps of the default list are never useful; fewer, closer steps also mean fewer cache variants.
    deviceSizes: [360, 414, 640, 768, 1024, 1280, 1536, 1920],
    imageSizes: [32, 48, 64, 96, 128, 192, 256, 384],
    qualities: [75],
    // Product images get a new storage path when replaced (uuid file names), so a day is safe and saves re-optimising.
    minimumCacheTTL: 86400,
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
  async redirects() {
    return [
      // People guess /contact; the form lives on the Help page (section id="contact").
      { source: "/contact", destination: "/help#contact", permanent: true },
    ];
  },
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
      // Share card and home-screen icon: the page markup links them with a content-hash query, so a day is safe.
      {
        source: "/(opengraph-image|apple-icon).png",
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
