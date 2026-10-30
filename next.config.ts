import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets parallel local dev servers / builds use separate output dirs (NEXT_DIST_DIR=.next-a).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Next.js 16: top-level `cacheComponents` (replaces experimental.ppr / dynamicIO).
  cacheComponents: true,
  images: {
    remotePatterns: [
      // Local Supabase Storage (public buckets). Add the production Supabase host at launch.
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "54321",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    // Next 16 blocks local-IP image sources by default; only allow them in development.
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== "production",
  },
  partialPrefetching: true,
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
