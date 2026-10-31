import { connection } from "next/server";

import { JsonLd } from "@/components/store/JsonLd";
import { absoluteUrl } from "@/lib/seo";
import { getDb } from "@/server/db";
import { getLiveAvailability } from "@/server/services/catalog";
import type { ProductDetail } from "@/server/services/queries/types";

import { markdownToPlainText } from "./markdown";
import type { PdpImage } from "./product-model";
import { StockControls } from "./StockControls";

/** schema.org Product with one Offer per variant (INR, availability from live stock). */
export function productJsonLd(
  product: ProductDetail,
  images: readonly PdpImage[],
  availability: ReadonlyMap<string, { inStock: boolean }>,
) {
  const url = absoluteUrl(`/products/${product.slug}`);
  const description = markdownToPlainText(product.descriptionMd, 500);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    url,
    ...(description ? { description } : {}),
    ...(images.length > 0 ? { image: images.map((i) => (i.src.startsWith("/") ? absoluteUrl(i.src) : i.src)) } : {}),
    category: product.type.name,
    brand: { "@type": "Brand", name: "IfOnli" },
    sku: product.variants[0]?.sku,
    offers: product.variants.map((v) => ({
      "@type": "Offer",
      sku: v.sku,
      url,
      priceCurrency: "INR",
      price: (v.pricePaise / 100).toFixed(2),
      itemCondition: "https://schema.org/NewCondition",
      availability:
        availability.get(v.id)?.inStock === false ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
    })),
  };
}

/**
 * The uncached part of the PDP: live stock per variant. A Suspense hole (the page shell is static); it
 * reads the request clock through `connection()` so it is never frozen at build time.
 */
export async function LiveStock({ product, images }: { product: ProductDetail; images: PdpImage[] }) {
  await connection();
  const availability = await getLiveAvailability(getDb(), product.id);
  return (
    <>
      <JsonLd data={productJsonLd(product, images, new Map(availability.map((a) => [a.variantId, a])))} />
      <StockControls availability={availability} />
    </>
  );
}
