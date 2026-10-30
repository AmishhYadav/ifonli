import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
