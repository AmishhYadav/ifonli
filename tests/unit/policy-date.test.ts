import { describe, expect, it } from "vitest";

import { formatPolicyDate } from "@/components/content/policy-date";

describe("formatPolicyDate", () => {
  it("shows the India calendar day of an effective date stored as midnight IST", () => {
    // The admin picks 1 Nov 2026 (IST); it is stored as 2026-10-31T18:30:00Z. UTC formatting would say 31 October.
    expect(formatPolicyDate("2026-10-31T18:30:00.000Z")).toBe("1 November 2026");
  });

  it("agrees for a seed date stored as UTC midnight (05:30 IST, same day)", () => {
    expect(formatPolicyDate("2026-11-01T00:00:00.000Z")).toBe("1 November 2026");
  });
});
