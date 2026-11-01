import { describe, expect, it } from "vitest";

import { buildFacts } from "@/features/landing/facts";

describe("landing facts", () => {
  it("quotes the store's own numbers", () => {
    const facts = buildFacts({ freeShippingRupees: 999, codEnabled: true, damageWindowHours: 72 });
    expect(facts.map((f) => f.id)).toEqual(["shipping", "cod", "damage", "moods"]);
    expect(facts[0]).toMatchObject({ figure: "₹999", count: 999, text: "Free shipping on orders of ₹999 or more." });
    expect(facts[2]).toMatchObject({ figure: "72h", count: 72 });
  });

  it("formats larger thresholds the Indian way", () => {
    const [shipping] = buildFacts({ freeShippingRupees: 1499, codEnabled: false, damageWindowHours: null });
    expect(shipping?.figure).toBe("₹1,499");
  });

  it("leaves out what the store does not offer instead of inventing it", () => {
    const facts = buildFacts({ freeShippingRupees: null, codEnabled: false, damageWindowHours: null });
    expect(facts.map((f) => f.id)).toEqual(["moods"]);
  });
});
