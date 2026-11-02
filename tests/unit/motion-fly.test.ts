import { describe, expect, it } from "vitest";

import { flyToTarget, findFlyTarget, pickVisible, pulseTarget } from "@/features/motion/fly";

const box = (visible: boolean, name: string) => ({
  name,
  getClientRects: () => (visible ? [{}] : []),
});

describe("pickVisible", () => {
  it("returns the first candidate that has a layout box", () => {
    const a = box(false, "hidden wishlist");
    const b = box(true, "first visible");
    const c = box(true, "second visible");
    expect(pickVisible([a, b, c])).toBe(b);
  });

  it("returns null when every candidate is hidden (e.g. the wishlist icon on mobile)", () => {
    expect(pickVisible([box(false, "a"), box(false, "b")])).toBeNull();
    expect(pickVisible([])).toBeNull();
  });
});

describe("server-side safety", () => {
  it("does nothing without a window", async () => {
    expect(findFlyTarget("cart")).toBeNull();
    expect(() => pulseTarget("cart")).not.toThrow();
    await expect(flyToTarget(null, "cart", { emoji: "x" })).resolves.toBeUndefined();
  });
});
