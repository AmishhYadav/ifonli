import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";

import { ProductCard, ProductGrid, ProductGridItem } from "@/components/store";
import { getReturnPolicySummary } from "@/components/store/cart/policy";
import { ReturnNote } from "@/components/store/cart/ReturnNote";
import { JsonLd } from "@/components/store/JsonLd";
import { Breadcrumbs } from "@/components/store/listing/CollectionHeader";
import { buildPdpImages, buildPdpModel } from "@/components/store/pdp/build-model";
import { BackButton } from "@/components/store/pdp/BackButton";
import { DeliveryEstimate } from "@/components/store/pdp/DeliveryEstimate";
import { Description } from "@/components/store/pdp/Description";
import { Gallery } from "@/components/store/pdp/Gallery";
import { LegalBlock } from "@/components/store/pdp/LegalBlock";
import { LiveStock } from "@/components/store/pdp/LiveStock";
import { markdownToPlainText } from "@/components/store/pdp/markdown";
import { PurchaseProvider } from "@/components/store/pdp/PurchaseProvider";
import { StockFallback } from "@/components/store/pdp/StockControls";
import { VariantPicker } from "@/components/store/pdp/VariantPicker";
import { VibeChip } from "@/components/ui/Chip";
import { PdpTracker } from "@/features/analytics";
import { isVibe } from "@/features/vibe/config";
import { WishlistHeart } from "@/features/wishlist/WishlistHeart";
import { breadcrumbJsonLd, textOr, type Crumb } from "@/lib/seo";
import {
  getAllProductSlugsForSitemap,
  getProductBySlug,
  getProductSlugRedirect,
  getRelatedProducts,
} from "@/server/cache/catalog";
import { getStoreInfo } from "@/server/cache/settings";
import { resolveImageUrl } from "@/server/services/media";

/**
 * Known slugs are prerendered (generateStaticParams); the stock line is an uncached Suspense hole. `params` is
 * read before anything streams so an unknown slug renders the themed not-found page (same approach as the
 * vibe pages: Cache Components has no `dynamicParams = false`).
 */
export const instant = false;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRERENDERED = 100;

export async function generateStaticParams() {
  const slugs = await getAllProductSlugsForSitemap();
  return slugs.slice(0, PRERENDERED).map(({ slug }) => ({ slug }));
}

const isValidSlug = (slug: string) => slug.length <= 120 && SLUG_RE.test(slug);

async function findProduct(slug: string) {
  if (!isValidSlug(slug)) return null;
  return getProductBySlug(slug);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const product = await findProduct((await params).slug);
  if (!product) return {};
  const description = textOr(
    product.seoDesc,
    markdownToPlainText(product.descriptionMd, 160) || `${product.name} from IfOnli.`,
  );
  const title = textOr(product.seoTitle, product.name);
  const cover = product.images.find((i) => i.kind === "photo") ?? product.images[0];
  let ogImage: string | undefined;
  if (cover) {
    try {
      ogImage = resolveImageUrl(cover.path);
    } catch {
      ogImage = undefined;
    }
  }
  return {
    title,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      title,
      description,
      type: "website",
      url: `/products/${product.slug}`,
      ...(ogImage ? { images: [{ url: ogImage, alt: cover?.alt || product.name }] } : {}),
    },
    twitter: { card: ogImage ? "summary_large_image" : "summary", title, description },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await findProduct(slug);
  if (!product) {
    // An admin renamed the product: send old links (and search engines) to the current URL. A slug
    // that is neither a product nor a redirect is an ordinary 404. Both happen before anything streams.
    const target = isValidSlug(slug) ? await getProductSlugRedirect(slug) : null;
    if (target) permanentRedirect(`/products/${target.slug}`);
    notFound();
  }

  const [related, store, returns] = await Promise.all([
    getRelatedProducts(product.id, 8),
    getStoreInfo(),
    getReturnPolicySummary(),
  ]);
  const model = buildPdpModel(product);
  const images = buildPdpImages(product);

  const crumbs: Crumb[] = [
    { name: "Home", path: "/home" },
    { name: "Shop", path: "/shop" },
    { name: product.type.name, path: `/types/${product.type.slug}` },
    { name: product.name, path: `/products/${product.slug}` },
  ];
  const vibes = product.vibes.flatMap((v) => (isVibe(v.slug) ? [{ ...v, slug: v.slug }] : []));

  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <PdpTracker productId={product.id} />
      <div className="mx-auto max-w-[1440px] px-4 pt-6 pb-4 sm:px-6">
        <BackButton fallbackHref={`/types/${product.type.slug}`} />
        <div className="mt-1">
          <Breadcrumbs crumbs={crumbs} />
        </div>
        <PurchaseProvider model={model}>
          <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-14">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <Gallery images={images} productName={product.name} primaryVibe={product.primaryVibe} />
            </div>

            <div className="flex min-w-0 flex-col gap-5">
              <header className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/types/${product.type.slug}`}
                      className="inline-flex min-h-11 items-center text-sm font-bold tracking-wide md:min-h-8 text-ink-muted uppercase underline-offset-4 hover:underline"
                    >
                      {product.type.name}
                    </Link>
                    <h1 className="font-display text-4xl leading-tight display-fx sm:text-5xl">{product.name}</h1>
                  </div>
                  <WishlistHeart productId={product.id} productName={product.name} appearance="inline" />
                </div>
                {vibes.length > 0 ? (
                  <ul aria-label="Vibes" className="flex flex-wrap gap-2">
                    {vibes.map((v) => (
                      <li key={v.slug}>
                        <VibeChip vibe={v.slug} href={`/vibes/${v.slug}`} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </header>

              <VariantPicker />

              <Suspense fallback={<StockFallback />}>
                <LiveStock product={product} images={images} />
              </Suspense>

              <DeliveryEstimate />
              <ReturnNote text={returns.text} />
              <Description markdown={product.descriptionMd} />
              <LegalBlock product={product} store={store} />
            </div>
          </div>
        </PurchaseProvider>
      </div>

      {related.length > 0 ? (
        <section aria-labelledby="related-heading" className="mx-auto mt-12 max-w-[1440px] px-4 sm:px-6">
          <h2 id="related-heading" className="font-display text-3xl display-fx">
            You might also like
          </h2>
          <ProductGrid className="mt-5" data-testid="related-products">
            {related.map((item) => (
              <ProductGridItem key={item.id}>
                <ProductCard
                  product={item}
                  sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw"
                  wishlist={<WishlistHeart productId={item.id} productName={item.name} />}
                />
              </ProductGridItem>
            ))}
          </ProductGrid>
        </section>
      ) : null}
    </>
  );
}
