import type { CartLine } from "@/server/domain";

let n = 0;
export function line(over: Partial<CartLine> = {}): CartLine {
  n += 1;
  return {
    lineId: `l${n}`,
    variantId: `v${n}`,
    productId: `p${n}`,
    typeSlug: "charms",
    vibeSlugs: ["cute"],
    unitPricePaise: 10_000,
    mrpPaise: 10_000,
    qty: 1,
    gstRateBp: 1800,
    ...over,
  };
}

/** mulberry32: small seeded PRNG for reproducible randomized tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
