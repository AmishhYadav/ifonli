import { describe, expect, it } from "vitest";

import { addressLines, formatDateRange, formatDateTime } from "@/components/orders/format";

describe("formatDateRange", () => {
  it("formats India calendar dates as a range, or one date when they match", () => {
    expect(formatDateRange("2026-11-04", "2026-11-06")).toBe("4 Nov to 6 Nov");
    expect(formatDateRange("2026-11-04", "2026-11-04")).toBe("4 Nov");
    expect(formatDateRange("2026-12-30", "2027-01-02")).toBe("30 Dec to 2 Jan");
  });
});

describe("formatDateTime", () => {
  it("shows India time with a lower-case am/pm", () => {
    expect(formatDateTime(new Date("2026-10-31T10:00:00Z"))).toBe("31 Oct 2026, 3:30 pm");
  });
});

describe("addressLines", () => {
  it("drops empty parts and joins city, state and pincode", () => {
    expect(
      addressLines({
        name: "Asha Rao",
        line1: "12 Marine Drive",
        line2: null,
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
      }),
    ).toEqual(["Asha Rao", "12 Marine Drive", "Mumbai, Maharashtra - 400001"]);
    expect(addressLines({})).toEqual([]);
  });
});
