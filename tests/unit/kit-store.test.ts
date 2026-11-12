import { beforeEach, describe, expect, it } from "vitest";

import { KIT_CHARMS, KIT_SLOTS, addToKit, clearKit, getKit, inKit, removeFromKit, type KitItem } from "@/components/store/kit/kit-store";

const charm = (n: number): KitItem => ({
  productId: `p${n}`,
  variantId: `v${n}`,
  name: `Charm ${n}`,
  slug: `charm-${n}`,
  imageSrc: null,
  pricePaise: 4900,
});

beforeEach(() => clearKit());

describe("DIY kit store", () => {
  it("has five boxes: the chain plus four charms", () => {
    expect(KIT_CHARMS).toBe(4);
    expect(KIT_SLOTS).toBe(5);
  });

  it("fills charm boxes in order and refuses a fifth charm", () => {
    for (const n of [1, 2, 3, 4]) expect(addToKit(charm(n))).toBe(true);
    expect(addToKit(charm(5))).toBe(false);
    expect(getKit().map((i) => i.productId)).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("refuses the same charm twice and frees its box when removed", () => {
    expect(addToKit(charm(1))).toBe(true);
    expect(addToKit(charm(1))).toBe(false);
    expect(inKit("p1")).toBe(true);
    removeFromKit("p1");
    expect(inKit("p1")).toBe(false);
    expect(getKit()).toEqual([]);
  });

  it("the next charm takes the box a removed one left free", () => {
    for (const n of [1, 2, 3]) addToKit(charm(n));
    removeFromKit("p2");
    addToKit(charm(4));
    expect(getKit().map((i) => i.productId)).toEqual(["p1", "p3", "p4"]);
  });
});
