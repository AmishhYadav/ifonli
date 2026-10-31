import { like } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuth } from "@/server/auth/auth";
import { getDb } from "@/server/db";
import { rateLimits } from "@/server/db/schema";

process.env.BETTER_AUTH_SECRET ||= "integration-test-secret-integration-test-secret";

afterEach(() => vi.restoreAllMocks());

describe("auth rate limits (Postgres-backed, shared across instances)", () => {
  it("caps sign-in codes per email address, whatever the IP", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const auth = getAuth();
    const email = "mailbomb-target@example.com";
    for (let i = 0; i < 5; i++) {
      await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    }
    await expect(
      auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } }),
    ).rejects.toMatchObject({ statusCode: 429 });

    // A different address is unaffected.
    await expect(
      auth.api.sendVerificationOTP({
        body: { email: "someone-else@example.com", type: "sign-in" },
      }),
    ).resolves.toBeDefined();
  });

  it("stores the HTTP handler's counters in rate_limits and blocks after the custom rule", async () => {
    const auth = getAuth();
    const call = () =>
      auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
          body: JSON.stringify({ email: "nobody@example.com", password: "not-a-password-123" }),
        }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await call()).status);

    expect(statuses.slice(0, 8)).not.toContain(429);
    expect(statuses.slice(8)).toEqual([429, 429]);

    const rows = await getDb().select().from(rateLimits).where(like(rateLimits.key, "ba:%"));
    expect(rows.length).toBeGreaterThan(0);
  });
});
