import type { MetadataRoute } from "next";

import { POLICY_LINKS } from "@/components/store/footer/Footer";
import { absoluteUrl } from "@/lib/seo";
import { getAllProductSlugsForSitemap, getCollections } from "@/server/cache/catalog";

/** Home, collections, products and policies (plan section 12). Cached reads, so the sitemap stays static. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [collections, products] = await Promise.all([
    getCollections(),
    getAllProductSlugsForSitemap(),
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
    ...POLICY_LINKS.map((p) => ({
      url: absoluteUrl(`/policies/${p.slug}`),
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })),
    { url: absoluteUrl("/help"), changeFrequency: "yearly", priority: 0.3 },
  ];
}
