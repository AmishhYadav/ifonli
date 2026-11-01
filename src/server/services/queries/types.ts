/** Public shapes returned by the catalogue services (all plain, serialisable data). */

export interface ImageRef {
  path: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface ProductCard {
  id: string;
  slug: string;
  name: string;
  typeSlug: string;
  typeName: string;
  /** Ordered: most prominent first (see `primaryVibe`). */
  vibeSlugs: string[];
  /**
   * The product's main vibe: lowest `featured_rank` across its vibes (NULL ranks last), then the
   * vibe's own `sort`, then slug. The seed ranks a product only in its main vibe, so for curated
   * data this is "the vibe the owner filed it under".
   */
  primaryVibe: string | null;
  /** Cheapest active variant price. */
  priceFromPaise: number;
  /** MRP of that cheapest variant (>= priceFromPaise). */
  mrpFromPaise: number;
  /**
   * The active variants do not all share one price, so `priceFromPaise` is a "From" price. Computed over
   * the same variant set as `priceFromPaise` (every active variant, sold out or not).
   */
  hasPriceRange: boolean;
  /** At least one active variant has available stock (on hand minus live reservations). */
  inStock: boolean;
  /** In stock, but every active variant is at or below its low-stock threshold. */
  lowStock: boolean;
  /**
   * Variant the card's quick "Add to bag" adds: the product's only active variant, when it has available
   * stock (on hand minus live reservations, the `inStock` rule). `null` for several variants or sold out.
   */
  quickAddVariantId: string | null;
  /** Primary image: first photo, else first cutout. */
  image: ImageRef | null;
  /** First cutout image, if any. */
  cutout: ImageRef | null;
}

export type ProductSort = "featured" | "newest" | "price_asc" | "price_desc";

export interface ListProductsParams {
  /** OR within the list. Slugs. */
  vibes?: string[];
  types?: string[];
  /** Applied to `priceFromPaise`. */
  priceMinPaise?: number;
  priceMaxPaise?: number;
  inStockOnly?: boolean;
  /** Country of origin (case-insensitive), OR within the list. */
  madeIn?: string[];
  /**
   * "featured": featured rank within `featuredForVibe` (or the single filtered vibe) ascending
   * with unranked last, then newest. With no vibe context it is simply newest first.
   * "newest": created_at desc, then slug. Default "featured".
   */
  sort?: ProductSort;
  /** 1-based. */
  page?: number;
  /** Default 24, max 60. */
  pageSize?: number;
  featuredForVibe?: string;
}

export interface FacetCount {
  slug: string;
  name: string;
  count: number;
}

export interface Facets {
  vibes: FacetCount[];
  types: FacetCount[];
  /** Min/max `priceFromPaise` of the products matching every filter except price. 0/0 if none. */
  priceRange: { min: number; max: number };
  madeIn: { country: string; count: number }[];
}

export interface ProductListResult {
  items: ProductCard[];
  /** Total products matching all filters (across all pages). */
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  /**
   * Disjunctive facets: each facet is counted over the products matching every filter EXCEPT
   * that facet's own, so a shopper can widen a selection. Selected values with no matches stay
   * listed with count 0.
   */
  facets: Facets;
}

export interface ProductDetail {
  id: string;
  slug: string;
  name: string;
  descriptionMd: string | null;
  isKit: boolean;
  seoTitle: string | null;
  seoDesc: string | null;
  createdAt: Date;
  updatedAt: Date;
  type: { id: string; slug: string; name: string; definition: string | null };
  vibes: { slug: string; name: string; featuredRank: number | null }[];
  primaryVibe: string | null;
  /** Legal Metrology / E-Commerce Rules block. HSN and GST rate are deliberately NOT exposed. */
  legal: {
    /** Product value, else the `default_country_of_origin` setting. */
    countryOfOrigin: string;
    countryOfOriginIsPlaceholder: boolean;
    netQuantity: string | null;
    dimensions: string | null;
    /** Product override, else the `default_manufacturer` setting. */
    manufacturer: { name: string; address: string };
    manufacturerSource: "product" | "default";
    manufacturerIsPlaceholder: boolean;
  };
  options: {
    id: string;
    name: string;
    position: number;
    values: { id: string; value: string; swatchHex: string | null; position: number }[];
  }[];
  /** Active variants only, by position. Stock is NOT included (fetch `getLiveAvailability`). */
  variants: {
    id: string;
    sku: string;
    title: string;
    optionValueIds: string[];
    pricePaise: number;
    mrpPaise: number;
    weightG: number | null;
    position: number;
    active: boolean;
  }[];
  /** Photos first, then cutouts; each by position. */
  images: {
    id: string;
    variantId: string | null;
    kind: "photo" | "cutout";
    path: string;
    alt: string;
    width: number | null;
    height: number | null;
    position: number;
    isPlaceholder: boolean;
  }[];
  priceFromPaise: number;
  mrpFromPaise: number;
  /** See `ProductCard.hasPriceRange`. */
  hasPriceRange: boolean;
}

export interface LiveVariantAvailability {
  variantId: string;
  available: number;
  inStock: boolean;
  /** In stock and at or below the variant's (or default) low-stock threshold. */
  lowStock: boolean;
  /** min(available, max_qty_per_line). */
  maxOrderable: number;
}

export interface CollectionInfo {
  id: string;
  slug: string;
  name: string;
  sort: number;
  description: string | null;
  seoTitle: string | null;
  seoDesc: string | null;
  /** Active, purchasable products in the collection. */
  productCount: number;
}

export interface VibeCollection extends CollectionInfo {
  heroCopy: string | null;
}

export interface TypeCollection extends CollectionInfo {
  definition: string | null;
}

export interface Collections {
  vibes: VibeCollection[];
  types: TypeCollection[];
}

export interface HeroTile {
  productId: string;
  slug: string;
  name: string;
  cutout: ImageRef;
}
