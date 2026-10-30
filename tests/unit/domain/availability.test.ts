import { describe, expect, it } from "vitest";

import { availableQty, clampQty, clampQtyWithReason, type ReservationLike } from "@/server/domain";

const now = new Date("2026-11-01T10:00:00Z");
const later = new Date("2026-11-01T10:15:00Z");
const earlier = new Date("2026-11-01T09:45:00Z");

const res = (qty: number, status: ReservationLike["status"], expiresAt: Date): ReservationLike => ({
  qty,
  status,
  expiresAt,
});

describe("availableQty", () => {
  it("is onHand with no reservations", () => {
    expect(availableQty(10, [], now)).toBe(10);
  });

  it("subtracts active unexpired reservations only", () => {
    const reservations = [
      res(2, "active", later),
      res(3, "active", earlier), // expired
      res(4, "converted", later),
      res(5, "released", later),
    ];
    expect(availableQty(10, reservations, now)).toBe(8);
  });

  it("treats the exact expiry instant as expired", () => {
    expect(availableQty(10, [res(4, "active", now)], now)).toBe(10);
    expect(availableQty(10, [res(4, "active", new Date(now.getTime() + 1))], now)).toBe(6);
  });

  it("never goes negative", () => {
    expect(availableQty(2, [res(5, "active", later)], now)).toBe(0);
    expect(availableQty(-3, [], now)).toBe(0);
  });
});

describe("clampQty", () => {
  it("passes through when within limits", () => {
    expect(clampQty(2, 5, 10)).toBe(2);
    expect(clampQtyWithReason(2, 5, 10)).toEqual({ qty: 2, limitedBy: null });
  });

  it("caps at availability or max per line, whichever is lower", () => {
    expect(clampQty(9, 3, 10)).toBe(3);
    expect(clampQtyWithReason(9, 3, 10)).toEqual({ qty: 3, limitedBy: "available" });
    expect(clampQty(9, 8, 5)).toBe(5);
    expect(clampQtyWithReason(9, 8, 5)).toEqual({ qty: 5, limitedBy: "max_per_line" });
    // tie: availability is the more useful message
    expect(clampQtyWithReason(9, 5, 5)).toEqual({ qty: 5, limitedBy: "available" });
  });

  it("handles zero stock, negatives, fractions and NaN", () => {
    expect(clampQty(3, 0, 10)).toBe(0);
    expect(clampQty(-4, 5, 10)).toBe(0);
    expect(clampQty(2.9, 5, 10)).toBe(2);
    expect(clampQty(Number.NaN, 5, 10)).toBe(0);
    expect(clampQty(3, -2, 10)).toBe(0);
    expect(clampQty(3, 5, -1)).toBe(0);
  });
});
