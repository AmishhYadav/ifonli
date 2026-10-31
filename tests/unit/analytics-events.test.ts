import { describe, expect, it } from "vitest";

import {
  CLIENT_EVENTS,
  GA4_EVENT_NAMES,
  PDP_SCROLL_MILESTONES,
  SERVER_EVENTS,
  newMilestones,
  normalizePath,
  normalizeSearchTerm,
  scrollDepthPercent,
  toGa4Event,
} from "@/lib/analytics/events";
import { parseConsent, shouldLoadGa4, shouldShowBanner, readConsent } from "@/features/analytics/consent";

describe("normalizePath", () => {
  it("drops query and hash and trailing slashes", () => {
    expect(normalizePath("/shop/?vibe=gothic&q=a#top")).toBe("/shop");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("")).toBe("/");
  });
  it("masks order references so confirmation URLs are never stored", () => {
    expect(normalizePath("/orders/IFO-2611-7K3Q?t=secret")).toBe("/orders/:ref");
  });
  it("caps the length", () => {
    expect(normalizePath(`/${"a".repeat(500)}`).length).toBe(200);
  });
});

describe("normalizeSearchTerm", () => {
  it("lower-cases and collapses whitespace", () => {
    expect(normalizeSearchTerm("  Heart   CHARM ")).toBe("heart charm");
  });
  it("drops terms that look like an e-mail or a phone number", () => {
    expect(normalizeSearchTerm("asha@example.com")).toBeNull();
    expect(normalizeSearchTerm("+91 98765 43210")).toBeNull();
    expect(normalizeSearchTerm("9876543210")).toBeNull();
  });
  it("keeps short numbers (sizes, years) and empty becomes null", () => {
    expect(normalizeSearchTerm("charm 2026")).toBe("charm 2026");
    expect(normalizeSearchTerm("   ")).toBeNull();
  });
  it("caps the length", () => {
    expect(normalizeSearchTerm("x".repeat(300))!.length).toBe(80);
  });
});

describe("scroll depth", () => {
  it("is the visible share of the content area", () => {
    // content 2000px tall starting at the top of an 800px viewport -> 40%
    expect(scrollDepthPercent(0, 2000, 800)).toBe(40);
    // scrolled 1200px: content top is at -1200, viewport bottom reaches 2000 -> 100%
    expect(scrollDepthPercent(-1200, 2000, 800)).toBe(100);
    // content starts below the fold
    expect(scrollDepthPercent(900, 2000, 800)).toBe(0);
    expect(scrollDepthPercent(0, 0, 800)).toBe(0);
  });
  it("reports each milestone once, in order, with sub-pixel tolerance", () => {
    expect(newMilestones(10, 0)).toEqual([]);
    expect(newMilestones(26, 0)).toEqual([25]);
    expect(newMilestones(80, 0)).toEqual([25, 50, 75]);
    expect(newMilestones(80, 50)).toEqual([75]);
    expect(newMilestones(99.7, 75)).toEqual([100]);
    expect(newMilestones(100, 100)).toEqual([]);
    expect(PDP_SCROLL_MILESTONES).toEqual([25, 50, 75, 100]);
  });
});

describe("event vocabulary", () => {
  it("never lets a client send a server event", () => {
    for (const e of SERVER_EVENTS) expect((CLIENT_EVENTS as readonly string[]).includes(e)).toBe(false);
  });
  it("maps every client event to a GA4 name or explicitly to none", () => {
    for (const e of CLIENT_EVENTS) expect(e in GA4_EVENT_NAMES).toBe(true);
    expect(GA4_EVENT_NAMES.product_impression).toBe("view_item_list");
    expect(GA4_EVENT_NAMES.pdp_view).toBe("view_item");
  });
  it("builds GA4 calls with the product id only", () => {
    expect(toGa4Event({ event: "add_to_cart", productId: "p1", value: 2 })).toEqual({
      name: "add_to_cart",
      params: { items: [{ item_id: "p1", quantity: 2 }] },
    });
    expect(toGa4Event({ event: "hero_play" })).toBeNull();
    expect(toGa4Event({ event: "search", value: 0, meta: { q: "dragon" } })?.params).toEqual({ search_term: "dragon" });
  });
});

describe("consent", () => {
  it("parses only the two known values", () => {
    expect(parseConsent("granted")).toBe("granted");
    expect(parseConsent("denied")).toBe("denied");
    expect(parseConsent("yes")).toBeNull();
    expect(parseConsent(undefined)).toBeNull();
  });
  it("reads the cookie out of a cookie string", () => {
    expect(readConsent("a=1; ifonli_consent=granted; b=2")).toBe("granted");
    expect(readConsent("a=1")).toBeNull();
  });
  it("loads GA4 only with an id and, when consent is required, only after a yes", () => {
    const base = { ga4Id: "G-ABC123", consentRequired: true };
    expect(shouldLoadGa4({ ...base, choice: null })).toBe(false);
    expect(shouldLoadGa4({ ...base, choice: "denied" })).toBe(false);
    expect(shouldLoadGa4({ ...base, choice: "granted" })).toBe(true);
    expect(shouldLoadGa4({ ga4Id: null, consentRequired: true, choice: "granted" })).toBe(false);
    // owner turned the banner off: loads unless the visitor refused
    expect(shouldLoadGa4({ ga4Id: "G-ABC123", consentRequired: false, choice: null })).toBe(true);
    expect(shouldLoadGa4({ ga4Id: "G-ABC123", consentRequired: false, choice: "denied" })).toBe(false);
  });
  it("shows the banner only when there is something to ask", () => {
    expect(shouldShowBanner({ ga4Id: "G-ABC123", consentRequired: true, choice: null })).toBe(true);
    expect(shouldShowBanner({ ga4Id: "G-ABC123", consentRequired: true, choice: "denied" })).toBe(false);
    expect(shouldShowBanner({ ga4Id: null, consentRequired: true, choice: null })).toBe(false);
    expect(shouldShowBanner({ ga4Id: "G-ABC123", consentRequired: false, choice: null })).toBe(false);
  });
});
