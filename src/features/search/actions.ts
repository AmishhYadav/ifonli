"use server";

import { z } from "zod";

import { getDb } from "@/server/db";
import { limitByIp } from "@/server/security/action-limit";
import { imageProps } from "@/server/services/media";
import { quickSearch } from "@/server/services/search";

export interface QuickResultProduct {
  slug: string;
  name: string;
  typeName: string;
  pricePaise: number;
  inStock: boolean;
  imageSrc: string | null;
}

export interface QuickResultCollection {
  kind: "vibe" | "type";
  slug: string;
  name: string;
}

export interface QuickResults {
  query: string;
  products: QuickResultProduct[];
  collections: QuickResultCollection[];
}

const inputSchema = z.string().max(100);
const EMPTY: QuickResults = { query: "", products: [], collections: [] };

/** Header search sheet: instant results (top 6 products plus matching vibes/types). Uncached by design. */
export async function quickSearchAction(q: string): Promise<QuickResults> {
  const parsed = inputSchema.safeParse(q);
  if (!parsed.success || parsed.data.trim().length < 2) return EMPTY;

  // Search-as-you-type is debounced client side; this only stops scripted hammering of the trigram search.
  const limit = await limitByIp("search", { limit: 90, windowSeconds: 60 });
  if (limit && !limit.allowed) return EMPTY;

  const result = await quickSearch(getDb(), parsed.data, 6);
  return {
    query: result.query,
    collections: result.collections.slice(0, 4),
    products: result.products.map((p) => {
      let imageSrc: string | null = null;
      if (p.image) {
        try {
          imageSrc = imageProps(p.image).src;
        } catch {
          imageSrc = null;
        }
      }
      return {
        slug: p.slug,
        name: p.name,
        typeName: p.typeName,
        pricePaise: p.priceFromPaise,
        inStock: p.inStock,
        imageSrc,
      };
    }),
  };
}
