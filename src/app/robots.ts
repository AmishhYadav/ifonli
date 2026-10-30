import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/checkout", "/account", "/search", "/api", "/dev", "/styleguide"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
