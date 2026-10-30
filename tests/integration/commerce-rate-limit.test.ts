import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { rateLimits } from "@/server/db/schema";
import { consumeRateLimit, pruneRateLimits } from "@/server/services/rate-limit";

const db = () => getDb();
const rule = { limit: 3, windowSeconds: 60 };

describe("consumeRateLimit", () => {
  it("allows up to the limit within a window, then blocks, counting every attempt", async () => {
    const now = new Date("2026-11-02T10:00:10Z");
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await consumeRateLimit(db(), "coupon:ip:1.1.1.1", rule, now));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0, 0]);
    expect(results[0]!.retryAfterSeconds).toBe(50);
    const [row] = await db().select().from(rateLimits).where(eq(rateLimits.key, "coupon:ip:1.1.1.1"));
    expect(row!.count).toBe(5);
  });

  it("starts a fresh window, and keys are independent", async () => {
    const t0 = new Date("2026-11-02T10:00:10Z");
    for (let i = 0; i < 4; i++) await consumeRateLimit(db(), "a", rule, t0);
    expect((await consumeRateLimit(db(), "a", rule, t0)).allowed).toBe(false);
    expect((await consumeRateLimit(db(), "b", rule, t0)).allowed).toBe(true);
    const t1 = new Date("2026-11-02T10:01:00Z"); // next window
    const next = await consumeRateLimit(db(), "a", rule, t1);
    expect(next).toMatchObject({ allowed: true, remaining: 2, retryAfterSeconds: 60 });
  });

  it("is atomic under concurrency", async () => {
    const now = new Date("2026-11-02T10:00:10Z");
    const out = await Promise.all(
      Array.from({ length: 10 }, () => consumeRateLimit(db(), "race", rule, now)),
    );
    expect(out.filter((r) => r.allowed)).toHaveLength(3);
  });

  it("prunes old windows only", async () => {
    await consumeRateLimit(db(), "old", rule, new Date("2026-11-01T10:00:00Z"));
    await consumeRateLimit(db(), "new", rule, new Date("2026-11-02T10:00:00Z"));
    expect(await pruneRateLimits(db(), new Date("2026-11-02T00:00:00Z"))).toBe(1);
    expect((await db().select().from(rateLimits)).map((r) => r.key)).toEqual(["new"]);
  });
});
