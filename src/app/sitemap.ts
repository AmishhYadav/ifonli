import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/seo";
import { getAllProductSlugsForSitemap, getCollections } from "@/server/cache/catalog";
import { getPolicyIndex } from "@/server/content/cached";

/**
 * Home, collections, products and published policies (plan section 12). Cached reads, so the sitemap stays
 * static. Drafts are left out: their pages are marked noindex, so listing them would contradict that.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [collections, products, policies] = await Promise.all([
    getCollections(),
    getAllProductSlugsForSitemap(),
    getPolicyIndex(),
  ]);
  return [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/shop"), changeFrequency: "daily", priority: 0.9 },
    ...collections.vibes.map((v) => ({
      url: absoluteUrl(`/vibes/${v.slug}`),
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...collections.types.map((t) => ({
      url: absoluteUrl(`/types/${t.slug}`),
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...products.map((p) => ({
      url: absoluteUrl(`/products/${p.slug}`),
      lastModified: p.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...policies
      .filter((p) => p.published)
      .map((p) => ({
        url: absoluteUrl(`/policies/${p.slug}`),
        changeFrequency: "yearly" as const,
        priority: 0.3,
      })),
    { url: absoluteUrl("/help"), changeFrequency: "yearly", priority: 0.3 },
  ];
}
