import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuth } from "@/server/auth/auth";
import { getDb } from "@/server/db";
import { user } from "@/server/db/schema";

process.env.BETTER_AUTH_SECRET ||= "integration-test-secret-integration-test-secret";

afterEach(() => vi.restoreAllMocks());

describe("better auth wiring", () => {
  it("email OTP sign-in creates a customer and the dev sender logs the code", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const auth = getAuth();
    await auth.api.sendVerificationOTP({ body: { email: "buyer@example.com", type: "sign-in" } });
    const line = spy.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes("buyer@example.com"));
    const otp = line?.match(/: (\d{6})$/)?.[1];
    expect(otp).toBeDefined();

    const res = await auth.api.signInEmailOTP({ body: { email: "buyer@example.com", otp: otp! } });
    expect(res.user.email).toBe("buyer@example.com");

    const [row] = await getDb().select().from(user).where(eq(user.email, "buyer@example.com"));
    expect(row?.role).toBe("customer");
    expect(row?.emailVerified).toBe(true);
  });

  it("registers the admin, emailOTP and twoFactor plugins", () => {
    const ids = getAuth().options.plugins?.map((p) => p.id) ?? [];
    expect(ids).toEqual(expect.arrayContaining(["email-otp", "admin", "two-factor"]));
  });
});
