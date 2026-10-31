import { describe, expect, it } from "vitest";

import { eventBatchSchema, toEventRows } from "@/server/services/analytics/schema";
import { isLikelyBot } from "@/server/services/analytics/bots";

const SID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const PID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const parse = (events: unknown[], sessionId: unknown = SID) => eventBatchSchema.safeParse({ sessionId, events });

describe("event batch schema", () => {
  it("accepts a normal batch", () => {
    const r = parse([
      { event: "page_view", path: "/", vibe: "cute" },
      { event: "product_impression", productId: PID, path: "/shop", meta: { pos: 3 } },
      { event: "pdp_scroll_depth", productId: PID, value: 75 },
      { event: "search", value: 0, meta: { q: "dragon" } },
      { event: "hero_tile_click", meta: { tile: "3" } },
    ]);
    expect(r.success).toBe(true);
  });

  it("rejects server-only and unknown events", () => {
    expect(parse([{ event: "purchase", value: 100 }]).success).toBe(false);
    expect(parse([{ event: "purchase_item", productId: PID }]).success).toBe(false);
    expect(parse([{ event: "nope" }]).success).toBe(false);
  });

  it("requires a product id for product events and a valid milestone for scroll depth", () => {
    expect(parse([{ event: "pdp_view" }]).success).toBe(false);
    expect(parse([{ event: "add_to_cart", productId: "not-a-uuid" }]).success).toBe(false);
    expect(parse([{ event: "pdp_scroll_depth", productId: PID, value: 60 }]).success).toBe(false);
    expect(parse([{ event: "pdp_scroll_depth", productId: PID }]).success).toBe(false);
  });

  it("validates the session id, batch size and field shapes", () => {
    expect(parse([{ event: "page_view" }], "short").success).toBe(false);
    expect(parse([{ event: "page_view" }], "has spaces and symbols!!!!!!").success).toBe(false);
    expect(parse([]).success).toBe(false);
    expect(parse(Array.from({ length: 21 }, () => ({ event: "page_view" }))).success).toBe(false);
    expect(parse(Array.from({ length: 20 }, () => ({ event: "page_view" }))).success).toBe(true);
    expect(parse([{ event: "page_view", path: "no-leading-slash" }]).success).toBe(false);
    expect(parse([{ event: "page_view", vibe: "Not A Vibe!" }]).success).toBe(false);
    expect(parse([{ event: "page_view", value: -1 }]).success).toBe(false);
    expect(parse([{ event: "page_view", value: 1.5 }]).success).toBe(false);
  });

  it("limits meta: key count, key shape, value type and length", () => {
    const many = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i]));
    expect(parse([{ event: "page_view", meta: many }]).success).toBe(false);
    expect(parse([{ event: "page_view", meta: { "bad key": 1 } }]).success).toBe(false);
    expect(parse([{ event: "page_view", meta: { a: { nested: true } } }]).success).toBe(false);
    expect(parse([{ event: "page_view", meta: { a: "x".repeat(101) } }]).success).toBe(false);
  });

  it("refuses search terms that look like an e-mail address", () => {
    expect(parse([{ event: "search", value: 1, meta: { q: "me@example.com" } }]).success).toBe(false);
    expect(parse([{ event: "search", meta: { q: "x" } }]).success).toBe(false);
  });
});

describe("toEventRows", () => {
  const now = new Date("2026-11-01T10:00:00Z");
  it("normalises paths, nulls absent fields and stamps the server time", () => {
    const parsed = parse([
      { event: "page_view", path: "/orders/IFO-1?t=secret" },
      { event: "view_cart" },
    ]);
    if (!parsed.success) throw new Error("expected valid");
    const rows = toEventRows(parsed.data, now);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sessionId: SID, event: "page_view", path: "/orders/:ref", productId: null, meta: null, ts: now });
    expect(rows[1]).toMatchObject({ path: null, value: null, vibe: null });
  });
  it("drops events from admin and api paths", () => {
    const parsed = parse([{ event: "page_view", path: "/admin/orders" }, { event: "page_view", path: "/api/x" }, { event: "page_view", path: "/" }]);
    if (!parsed.success) throw new Error("expected valid");
    expect(toEventRows(parsed.data, now).map((r) => r.path)).toEqual(["/"]);
  });
});

describe("isLikelyBot", () => {
  const chrome =
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
  it("lets real browsers through", () => {
    expect(isLikelyBot(chrome)).toBe(false);
    expect(isLikelyBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isLikelyBot("Mozilla/5.0 (Linux; Android 12; Cubot P50) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36")).toBe(false);
  });
  it("drops crawlers, headless browsers, scripts and empty agents", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0 Safari/537.36",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "python-requests/2.31.0 (a longer agent string)",
      "Mozilla/5.0 Chrome-Lighthouse AppleWebKit/537.36",
      "curl/8.4.0 and then some more text here",
      "",
      "short",
    ]) {
      expect(isLikelyBot(ua), ua).toBe(true);
    }
    expect(isLikelyBot(null)).toBe(true);
  });
});
