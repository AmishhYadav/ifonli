import type { LandingFacts } from "@/server/cache/landing";

export interface Fact {
  id: string;
  /** Big figure, in its final form (what shows with JS off and under reduced motion). */
  figure: string;
  /** When set, the figure counts up from 0 to this number as you scroll. */
  count?: number;
  prefix?: string;
  suffix?: string;
  text: string;
}

const inr = new Intl.NumberFormat("en-IN");

/** Facts to show, in order. A fact the store does not currently offer is left out rather than faked. */
export function buildFacts(facts: LandingFacts): Fact[] {
  const out: Fact[] = [];
  if (facts.freeShippingRupees !== null) {
    out.push({
      id: "shipping",
      figure: `₹${inr.format(facts.freeShippingRupees)}`,
      count: facts.freeShippingRupees,
      prefix: "₹",
      text: `Free shipping on orders of ₹${inr.format(facts.freeShippingRupees)} or more.`,
    });
  }
  if (facts.codEnabled) {
    out.push({
      id: "cod",
      figure: "COD",
      text: "Cash on delivery, so you can pay when it arrives.",
    });
  }
  if (facts.damageWindowHours !== null) {
    out.push({
      id: "damage",
      figure: `${facts.damageWindowHours}h`,
      count: facts.damageWindowHours,
      suffix: "h",
      text: `Report a damaged item within ${facts.damageWindowHours} hours and we will make it right.`,
    });
  }
  out.push({
    id: "moods",
    figure: "5",
    count: 5,
    text: "Moods to shop by, four kinds of tiny things, all made in India.",
  });
  return out;
}
