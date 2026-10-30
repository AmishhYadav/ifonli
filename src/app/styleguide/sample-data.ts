import type { Vibe } from "@/features/vibe/config";
import type { ProductCard } from "@/server/services/queries/types";

/** Hard-coded sample data for the styleguide (this route never reads the database). */

const cutout = (file: string, alt: string) => ({
  path: `/placeholders/cutouts/${file}`,
  alt,
  width: 512,
  height: 512,
});

export function sampleProduct(overrides: Partial<ProductCard> & { file?: string }): ProductCard {
  const { file, ...rest } = overrides;
  const image = file ? cutout(file, "Placeholder product art") : null;
  return {
    id: rest.slug ?? "sample",
    slug: "sample",
    name: "Sample product",
    typeSlug: "charm",
    typeName: "Charm",
    vibeSlugs: [],
    primaryVibe: null,
    priceFromPaise: 34900,
    mrpFromPaise: 34900,
    hasMultipleVariants: false,
    inStock: true,
    lowStock: false,
    image,
    cutout: image,
    ...rest,
  };
}

/** One product per vibe column (and a neutral one for the Buy column). */
export const COLUMN_PRODUCT: Record<Vibe | "buy", ProductCard> = {
  cute: sampleProduct({
    slug: "heart-charm",
    name: "Heart charm",
    primaryVibe: "cute",
    priceFromPaise: 34900,
    mrpFromPaise: 44900,
    file: "charm-heart.svg",
  }),
  bold: sampleProduct({
    slug: "lightning-charm",
    name: "Lightning charm",
    primaryVibe: "bold",
    priceFromPaise: 29900,
    mrpFromPaise: 29900,
    file: "charm-lightning.svg",
  }),
  overthinking: sampleProduct({
    slug: "hmm-bubble",
    name: "Hmm bubble sticker",
    typeSlug: "sticker-3d",
    typeName: "3D sticker",
    primaryVibe: "overthinking",
    priceFromPaise: 19900,
    mrpFromPaise: 19900,
    hasMultipleVariants: true,
    file: "sticker3d-hmm-bubble.svg",
  }),
  gothic: sampleProduct({
    slug: "skull-charm",
    name: "Skull charm",
    primaryVibe: "gothic",
    priceFromPaise: 39900,
    mrpFromPaise: 49900,
    lowStock: true,
    file: "charm-skull.svg",
  }),
  funky: sampleProduct({
    slug: "retro-sun",
    name: "Retro sun sticker",
    typeSlug: "sticker-3d",
    typeName: "3D sticker",
    primaryVibe: "funky",
    priceFromPaise: 22900,
    mrpFromPaise: 22900,
    inStock: false,
    file: "sticker3d-retro-sun.svg",
  }),
  buy: sampleProduct({
    slug: "star-charm",
    name: "Star charm",
    priceFromPaise: 34900,
    mrpFromPaise: 34900,
    file: "charm-star.svg",
  }),
};

/** The grid showing each card state. */
export const GRID_PRODUCTS: { label: string; product: ProductCard }[] = [
  {
    label: "Regular",
    product: sampleProduct({
      slug: "moon-charm",
      name: "Moon charm",
      primaryVibe: "gothic",
      file: "charm-moon.svg",
    }),
  },
  {
    label: "On sale (real MRP)",
    product: sampleProduct({
      slug: "cherries-charm",
      name: "Cherries charm",
      primaryVibe: "cute",
      priceFromPaise: 27900,
      mrpFromPaise: 34900,
      file: "charm-cherries.svg",
    }),
  },
  {
    label: "Variable price (From)",
    product: sampleProduct({
      slug: "charm-bracelet-kit",
      name: "DIY charm bracelet kit",
      typeSlug: "diy",
      typeName: "DIY kit",
      primaryVibe: "funky",
      priceFromPaise: 79900,
      mrpFromPaise: 99900,
      hasMultipleVariants: true,
      file: "diy-charm-bracelet-kit.svg",
    }),
  },
  {
    label: "Low stock",
    product: sampleProduct({
      slug: "ghost-charm",
      name: "Ghost charm",
      primaryVibe: "gothic",
      lowStock: true,
      file: "charm-ghost.svg",
    }),
  },
  {
    label: "Sold out (still linked)",
    product: sampleProduct({
      slug: "daisy-pin",
      name: "Daisy Hipper pin",
      typeSlug: "hipper",
      typeName: "Hipper",
      primaryVibe: "cute",
      inStock: false,
      file: "hipper-daisy-pin.svg",
    }),
  },
  {
    label: "No image",
    product: sampleProduct({
      slug: "no-image",
      name: "Product without a photo yet",
      primaryVibe: "overthinking",
    }),
  },
  {
    label: "Long name",
    product: sampleProduct({
      slug: "long-name",
      name: "Extra-long product name that wraps onto several lines in the grid",
      primaryVibe: "bold",
      file: "hipper-crossed-bones-pin.svg",
    }),
  },
  {
    label: "Photo (not a cutout)",
    product: {
      ...sampleProduct({
        slug: "photo",
        name: "Cat face sticker",
        typeSlug: "sticker-3d",
        typeName: "3D sticker",
        primaryVibe: "cute",
        file: "sticker3d-cat-face.svg",
      }),
      cutout: null,
    },
  },
];
