import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `after()` only works inside a Next request; collect the callbacks and run them by hand.
const afterCallbacks: (() => unknown)[] = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    afterCallbacks.push(fn);
  },
}));

import { POST } from "@/app/api/events/route";
import { getDb } from "@/server/db";
import { analyticsEvents, rateLimits } from "@/server/db/schema";
import {
  INGEST_IP_RULE,
  INGEST_SESSION_RULE,
  handleEventsRequest,
  type IngestRequest,
} from "@/server/services/analytics/ingest";

const db = () => getDb();
const CHROME =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const SID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const PID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const body = (events: unknown[] = [{ event: "page_view", path: "/" }], sessionId = SID) =>
  JSON.stringify({ sessionId, events });

const req = (over: Partial<IngestRequest> = {}): IngestRequest => ({
  body: body(),
  contentLength: null,
  userAgent: CHROME,
  origin: "https://ifonli.test",
  host: "ifonli.test",
  ip: "203.0.113.7",
  ...over,
});

const rows = () => db().select().from(analyticsEvents);

beforeEach(() => {
  afterCallbacks.length = 0;
});

describe("events ingest", () => {
  it("validates, then stores the batch only when the commit step runs", async () => {
    const out = await handleEventsRequest(
      db(),
      req({
        body: body([
          { event: "page_view", path: "/shop?vibe=gothic", vibe: "gothic" },
          { event: "product_impression", productId: PID, path: "/shop", meta: { pos: 2 } },
          { event: "search", value: 0, meta: { q: "dragon" }, path: "/search" },
        ]),
      }),
    );
    expect(out.status).toBe(204);
    expect(await rows()).toHaveLength(0); // nothing written before commit
    if (out.status !== 204 || !out.commit) throw new Error("expected a commit step");
    expect(await out.commit()).toBe(3);

    const stored = await rows();
    expect(stored).toHaveLength(3);
    const view = stored.find((r) => r.event === "page_view")!;
    expect(view).toMatchObject({ sessionId: SID, path: "/shop", vibe: "gothic", productId: null });
    const imp = stored.find((r) => r.event === "product_impression")!;
    expect(imp).toMatchObject({ productId: PID, meta: { pos: 2 } });
    expect(stored.find((r) => r.event === "search")).toMatchObject({ value: 0, meta: { q: "dragon" } });
  });

  it("rejects bad JSON, bad shapes, server-only events and unknown fields' values with 400", async () => {
    for (const bad of [
      "not json",
      "{}",
      body([]),
      body([{ event: "purchase", value: 1 }]),
      body([{ event: "pdp_view" }]),
      body([{ event: "page_view" }], "short"),
    ]) {
      expect(await handleEventsRequest(db(), req({ body: bad }))).toEqual({ status: 400, error: expect.any(String) });
    }
    expect(await rows()).toHaveLength(0);
  });

  it("rejects oversized bodies (declared or actual) with 413", async () => {
    const big = JSON.stringify({ sessionId: SID, events: [{ event: "page_view" }], padding: "x".repeat(9000) });
    expect(big.length).toBeGreaterThan(8 * 1024);
    expect(await handleEventsRequest(db(), req({ body: big }))).toMatchObject({ status: 413 });
    expect(await handleEventsRequest(db(), req({ contentLength: 999_999 }))).toMatchObject({ status: 413 });
  });

  it("rejects a foreign Origin with 403 and accepts a missing one", async () => {
    expect(await handleEventsRequest(db(), req({ origin: "https://evil.example" }))).toMatchObject({ status: 403 });
    expect(await handleEventsRequest(db(), req({ origin: "not a url" }))).toMatchObject({ status: 403 });
    expect(await handleEventsRequest(db(), req({ origin: null }))).toMatchObject({ status: 204 });
  });

  it("ignores bots silently: 204, nothing stored, no rate-limit slot used", async () => {
    for (const userAgent of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "python-requests/2.31.0 (scripted client)",
      null,
    ]) {
      const out = await handleEventsRequest(db(), req({ userAgent }));
      expect(out).toMatchObject({ status: 204, reason: "bot", commit: null });
    }
    expect(await rows()).toHaveLength(0);
    expect(await db().select({ n: count() }).from(rateLimits)).toEqual([{ n: 0 }]);
  });

  it("drops events from admin and api pages", async () => {
    const out = await handleEventsRequest(db(), req({ body: body([{ event: "page_view", path: "/admin/orders" }]) }));
    expect(out).toMatchObject({ status: 204, reason: "empty", commit: null });
  });

  it("rate limits per IP, with Retry-After information", async () => {
    const now = new Date("2026-11-01T10:00:30Z");
    for (let i = 0; i < INGEST_IP_RULE.limit; i++) {
      // a fresh session each time so only the IP limit can trip
      const out = await handleEventsRequest(db(), req({ now, body: body(undefined, `s${String(i).padStart(20, "0")}`) }));
      expect(out.status).toBe(204);
    }
    const blocked = await handleEventsRequest(db(), req({ now, body: body(undefined, "s".padEnd(20, "z")) }));
    expect(blocked).toMatchObject({ status: 429, error: "rate_limited" });
    if (blocked.status !== 429) throw new Error("expected 429");
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(INGEST_IP_RULE.windowSeconds);
    // another IP is unaffected
    expect((await handleEventsRequest(db(), req({ now, ip: "198.51.100.9", body: body(undefined, "o".padEnd(20, "o")) }))).status).toBe(204);
    // and the next window opens again
    expect((await handleEventsRequest(db(), req({ now: new Date(now.getTime() + 60_000), body: body(undefined, "n".padEnd(20, "n")) }))).status).toBe(204);
  });

  it("rate limits per session", async () => {
    const now = new Date("2026-11-01T10:00:30Z");
    for (let i = 0; i < INGEST_SESSION_RULE.limit; i++) {
      expect((await handleEventsRequest(db(), req({ now, ip: `10.0.0.${i}` }))).status).toBe(204);
    }
    expect(await handleEventsRequest(db(), req({ now, ip: "10.0.1.1" }))).toMatchObject({ status: 429 });
  });
});

describe("POST /api/events", () => {
  const post = (b: string, headers: Record<string, string> = {}) =>
    POST(
      new Request("https://ifonli.test/api/events", {
        method: "POST",
        body: b,
        headers: { "content-type": "application/json", "user-agent": CHROME, origin: "https://ifonli.test", host: "ifonli.test", "x-forwarded-for": "203.0.113.50", ...headers },
      }),
    );

  it("answers 204 immediately and stores the events in after()", async () => {
    const res = await post(body([{ event: "view_cart", path: "/cart" }]));
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
    expect(await rows()).toHaveLength(0);
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]!();
    expect(await db().select().from(analyticsEvents).where(eq(analyticsEvents.event, "view_cart"))).toHaveLength(1);
  });

  it("returns JSON errors with the right status and no after() work", async () => {
    const res = await post("{");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_json" });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("sets Retry-After on 429 and ignores bots without scheduling work", async () => {
    const bot = await post(body(), { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" });
    expect(bot.status).toBe(204);
    expect(afterCallbacks).toHaveLength(0);

    for (let i = 0; i < INGEST_IP_RULE.limit; i++) {
      await post(body(undefined, `r${String(i).padStart(20, "0")}`), { "x-forwarded-for": "203.0.113.99" });
    }
    const res = await post(body(undefined, "r".padEnd(24, "x")), { "x-forwarded-for": "203.0.113.99" });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });
});
