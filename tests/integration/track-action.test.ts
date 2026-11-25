import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TrackFormState } from "@/app/(buy)/track/types";

let callerIp = "203.0.113.1";
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": callerIp }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { trackOrder } = await import("@/app/(buy)/track/actions");

const idle: TrackFormState = { status: "idle", values: { ref: "", contact: "" } } as TrackFormState;

let contactSeq = 0;
/** One lookup; every call uses a fresh contact unless one is given, so the per-contact budget stays out of the way. */
function submit(ref: string, contact = `someone${++contactSeq}@example.com`) {
  const form = new FormData();
  form.set("ref", ref);
  form.set("contact", contact);
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

  it("caps lookups per contact across many IPs, however the contact is written, and counts every lookup", async () => {
    const statuses: string[] = [];
    for (let i = 0; i < 16; i++) {
      callerIp = `192.0.2.${i + 1}`; // a new IP every time, so only the contact budget can stop it
      const contact = i % 2 ? "Victim@Example.com " : "victim@example.com";
      statuses.push((await submit(`IFO-2611-${String(2000 + i)}`, contact)).status);
    }
    expect(statuses.slice(0, 15)).toEqual(Array(15).fill("not_found"));
    expect(statuses[15]).toBe("rate_limited");

    // A phone number has its own budget, and so does every other e-mail.
    callerIp = "192.0.2.200";
    expect((await submit("IFO-2611-3000", "98765 43210")).status).toBe("not_found");
    expect((await submit("IFO-2611-3001", "other@example.com")).status).toBe("not_found");
  });

  it("does not spend the contact budget on a caller who is already blocked by IP", async () => {
    const contact = "patient@example.com";
    callerIp = "203.0.113.90";
    for (let i = 0; i < 20; i++) await submit(`IFO-2611-${String(4000 + i)}`); // uses up this IP
    for (let i = 0; i < 5; i++) {
      expect((await submit(`IFO-2611-${String(4100 + i)}`, contact)).status).toBe("rate_limited");
    }
    // Those 5 blocked tries left the contact's 15 lookups untouched.
    callerIp = "203.0.113.91";
    for (let i = 0; i < 15; i++) {
      expect((await submit(`IFO-2611-${String(4200 + i)}`, contact)).status).toBe("not_found");
    }
    expect((await submit("IFO-2611-4300", contact)).status).toBe("rate_limited");
  });
});
