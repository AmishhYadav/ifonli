import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TrackFormState } from "@/app/(buy)/track/types";

let callerIp = "203.0.113.1";
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": callerIp }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { trackOrder } = await import("@/app/(buy)/track/actions");

const idle: TrackFormState = { status: "idle", values: { ref: "", contact: "" } } as TrackFormState;

function submit(ref: string) {
  const form = new FormData();
  form.set("ref", ref);
  form.set("contact", "someone@example.com");
  return trackOrder(idle, form);
}

describe("trackOrder rate limits", () => {
  beforeEach(() => {
    callerIp = "203.0.113.1";
  });

  it("wrong guesses from one IP cannot lock the real customer out of the same reference", async () => {
    const ref = "IFO-2611-ABCD";
    callerIp = "203.0.113.50";
    const attempts: string[] = [];
    for (let i = 0; i < 9; i++) attempts.push((await submit(ref)).status);
    expect(attempts.slice(0, 8)).toEqual(Array(8).fill("not_found"));
    expect(attempts[8]).toBe("rate_limited");

    // The customer, from their own connection, is still answered normally.
    callerIp = "198.51.100.9";
    expect((await submit(ref)).status).toBe("not_found");
  });

  it("still caps one IP across many references", async () => {
    callerIp = "203.0.113.77";
    const statuses: string[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await submit(`IFO-2611-${String(1000 + i)}`)).status);
    expect(statuses[19]).toBe("not_found");
    expect(statuses[20]).toBe("rate_limited");
  });
});
