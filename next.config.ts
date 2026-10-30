import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets parallel local dev servers / builds use separate output dirs (NEXT_DIST_DIR=.next-a).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Next.js 16: top-level `cacheComponents` (replaces experimental.ppr / dynamicIO).
  cacheComponents: true,
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
