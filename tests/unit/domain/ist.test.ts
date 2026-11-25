import { describe, expect, it } from "vitest";

import { formatIstDateTime } from "@/server/domain/ist";

describe("formatIstDateTime", () => {
  it("prints IST wall-clock time, 12-hour with am/pm", () => {
    expect(formatIstDateTime(new Date("2026-11-26T09:30:00.000Z"))).toBe("26 Nov 2026, 3:00 pm IST");
    expect(formatIstDateTime(new Date("2026-11-26T04:12:00.000Z"))).toBe("26 Nov 2026, 9:42 am IST");
  });

  it("rolls the date over at 18:30 UTC (midnight IST) and handles 12 am / 12 pm", () => {
    expect(formatIstDateTime(new Date("2026-11-26T18:29:00.000Z"))).toBe("26 Nov 2026, 11:59 pm IST");
    expect(formatIstDateTime(new Date("2026-11-26T18:30:00.000Z"))).toBe("27 Nov 2026, 12:00 am IST");
    expect(formatIstDateTime(new Date("2026-11-26T06:30:00.000Z"))).toBe("26 Nov 2026, 12:00 pm IST");
  });

  it("pads minutes and crosses the year end", () => {
    expect(formatIstDateTime(new Date("2026-12-31T18:35:00.000Z"))).toBe("1 Jan 2027, 12:05 am IST");
  });

  it("rejects an invalid date", () => {
    expect(() => formatIstDateTime(new Date("nope"))).toThrow(RangeError);
  });
});
