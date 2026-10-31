import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuth } from "@/server/auth/auth";
import { getDb } from "@/server/db";
import { customerProfiles, user } from "@/server/db/schema";
import { ensureProfile } from "@/server/services/account";

process.env.BETTER_AUTH_SECRET ||= "integration-test-secret-integration-test-secret";

afterEach(() => vi.restoreAllMocks());

/** Requests a sign-in code the way the login action does, and reads it from the dev sender's log line. */
async function requestCode(email: string): Promise<string> {
  const spy = vi.spyOn(console, "info").mockImplementation(() => {});
  await getAuth().api.sendVerificationOTP({ body: { email, type: "sign-in" } });
  const line = spy.mock.calls.map((c) => String(c[0])).find((l) => l.includes(email));
  const otp = line?.match(/: (\d{6})$/)?.[1];
  if (!otp) throw new Error("no OTP logged");
  return otp;
}

describe("customer e-mail OTP login", () => {
  it("creates the customer on first sign-in with the customer role, and the profile row follows", async () => {
    const email = "first-timer@example.com";
    const otp = await requestCode(email);
    const res = await getAuth().api.signInEmailOTP({ body: { email, otp } });
    expect(res.user.email).toBe(email);

    const [row] = await getDb().select().from(user).where(eq(user.email, email));
    expect(row).toMatchObject({ role: "customer", emailVerified: true });
    await ensureProfile(getDb(), row!.id);
    await ensureProfile(getDb(), row!.id);
    expect(await getDb().select().from(customerProfiles).where(eq(customerProfiles.userId, row!.id))).toHaveLength(1);
  });

  it("a wrong code does not sign in, and a used code cannot be replayed", async () => {
    const email = "careful@example.com";
    const otp = await requestCode(email);
    const wrong = otp === "000000" ? "111111" : "000000";
    await expect(getAuth().api.signInEmailOTP({ body: { email, otp: wrong } })).rejects.toThrow();
    await getAuth().api.signInEmailOTP({ body: { email, otp } });
    await expect(getAuth().api.signInEmailOTP({ body: { email, otp } })).rejects.toThrow();
  });

  it("refuses admin accounts: no code is sent and OTP sign-in fails (they use password + TOTP)", async () => {
    await getDb()
      .insert(user)
      .values({ id: "adm", name: "Admin", email: "boss@example.com", role: "owner", emailVerified: true });
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(
      getAuth().api.sendVerificationOTP({ body: { email: "boss@example.com", type: "sign-in" } }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(spy.mock.calls.some((c) => String(c[0]).includes("boss@example.com"))).toBe(false);
    await expect(
      getAuth().api.signInEmailOTP({ body: { email: "boss@example.com", otp: "123456" } }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
