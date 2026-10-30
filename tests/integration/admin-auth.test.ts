import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { upsertAdminUser } from "@/server/auth/admin-user";
import { getAuth } from "@/server/auth/auth";
import { getDb } from "@/server/db";
import { account, user } from "@/server/db/schema";

import { totp } from "../e2e/helpers/totp";

process.env.BETTER_AUTH_SECRET ||= "integration-test-secret-integration-test-secret";

afterEach(() => vi.restoreAllMocks());

const PASSWORD = "Correct-Horse-Battery-9";

describe("D-AUTH-1: credential sign-in is for admins only", () => {
  it("lets an admin sign in with a password (no TOTP enrolled yet: plain session)", async () => {
    await upsertAdminUser(getDb(), {
      email: "Boss@Example.com",
      role: "owner",
      password: PASSWORD,
    });
    const res = await getAuth().api.signInEmail({
      body: { email: "boss@example.com", password: PASSWORD },
    });
    expect(res.user.email).toBe("boss@example.com");
    expect((res as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBeFalsy();
  });

  it("rejects a wrong password with the same error as an unknown user", async () => {
    await upsertAdminUser(getDb(), {
      email: "boss@example.com",
      role: "owner",
      password: PASSWORD,
    });
    const wrong = getAuth().api.signInEmail({
      body: { email: "boss@example.com", password: "nope-nope-nope-1" },
    });
    const unknown = getAuth().api.signInEmail({
      body: { email: "ghost@example.com", password: PASSWORD },
    });
    await expect(wrong).rejects.toMatchObject({ statusCode: 401 });
    await expect(unknown).rejects.toMatchObject({ statusCode: 401 });
  });

  it("refuses credential sign-in for a customer even with a valid password hash", async () => {
    const { userId } = await upsertAdminUser(getDb(), {
      email: "shopper@example.com",
      role: "admin",
      password: PASSWORD,
    });
    await getDb().update(user).set({ role: "customer" }).where(eq(user.id, userId));
    expect((await getDb().select().from(account).where(eq(account.userId, userId))).length).toBe(1);
    await expect(
      getAuth().api.signInEmail({ body: { email: "shopper@example.com", password: PASSWORD } }),
    ).rejects.toMatchObject({ statusCode: 401, message: "Invalid email or password" });
  });

  it("has no public sign-up", async () => {
    await expect(
      getAuth().api.signUpEmail({
        body: { email: "new@example.com", password: PASSWORD, name: "New" },
      }),
    ).rejects.toBeDefined();
    expect(await getDb().select().from(user).where(eq(user.email, "new@example.com"))).toHaveLength(
      0,
    );
  });
});

describe("D-AUTH-1: email OTP is for customers only", () => {
  it("refuses OTP endpoints for admin roles but keeps them working for customers", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await upsertAdminUser(getDb(), {
      email: "boss@example.com",
      role: "admin",
      password: PASSWORD,
    });
    await expect(
      getAuth().api.sendVerificationOTP({ body: { email: "boss@example.com", type: "sign-in" } }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      getAuth().api.signInEmailOTP({ body: { email: "boss@example.com", otp: "123456" } }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(info).not.toHaveBeenCalled();

    await getAuth().api.sendVerificationOTP({
      body: { email: "buyer@example.com", type: "sign-in" },
    });
    expect(info).toHaveBeenCalledTimes(1);
  });
});

describe("D-AUTH-1: TOTP enrolment and challenge", () => {
  it("enrols TOTP from a session, then credential sign-in demands a second step", async () => {
    await upsertAdminUser(getDb(), {
      email: "boss@example.com",
      role: "owner",
      password: PASSWORD,
    });
    const auth = getAuth();
    const signedIn = await auth.api.signInEmail({
      body: { email: "boss@example.com", password: PASSWORD },
      returnHeaders: true,
    });
    const cookie = signedIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const headers = new Headers({ cookie });

    const enabled = await auth.api.enableTwoFactor({
      body: { password: PASSWORD, method: "totp" },
      headers,
    });
    if (enabled.method !== "totp") throw new Error("expected totp");
    expect(enabled.backupCodes.length).toBeGreaterThan(5);
    const secret = new URL(enabled.totpURI).searchParams.get("secret")!;

    // Not enabled until a code is verified.
    const [before] = await getDb().select().from(user).where(eq(user.email, "boss@example.com"));
    expect(before?.twoFactorEnabled).toBeFalsy();
    await expect(auth.api.verifyTOTP({ body: { code: "000000" }, headers })).rejects.toBeDefined();
    await auth.api.verifyTOTP({ body: { code: totp(secret) }, headers });
    const [after] = await getDb().select().from(user).where(eq(user.email, "boss@example.com"));
    expect(after?.twoFactorEnabled).toBe(true);

    // Now the credential flow returns a TOTP challenge instead of a session.
    const challenge = await auth.api.signInEmail({
      body: { email: "boss@example.com", password: PASSWORD },
    });
    expect(challenge).toMatchObject({ twoFactorRedirect: true });
  });

  it("blocks the admin plugin's endpoints for a session without TOTP", async () => {
    await upsertAdminUser(getDb(), {
      email: "boss@example.com",
      role: "owner",
      password: PASSWORD,
    });
    const auth = getAuth();
    const signedIn = await auth.api.signInEmail({
      body: { email: "boss@example.com", password: PASSWORD },
      returnHeaders: true,
    });
    const headers = new Headers({
      cookie: signedIn.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    });
    await expect(auth.api.listUsers({ query: {}, headers })).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

describe("upsertAdminUser", () => {
  it("creates then updates in place, validates input, and can reset 2FA", async () => {
    const db = getDb();
    const first = await upsertAdminUser(db, {
      email: "A@Example.com",
      role: "fulfilment",
      password: PASSWORD,
    });
    expect(first.created).toBe(true);
    const again = await upsertAdminUser(db, {
      email: "a@example.com",
      role: "admin",
      password: PASSWORD + "x",
      name: "Alex",
      resetTwoFactor: true,
    });
    expect(again).toEqual({ userId: first.userId, created: false });
    const [row] = await db.select().from(user).where(eq(user.id, first.userId));
    expect(row).toMatchObject({ role: "admin", name: "Alex", emailVerified: true });
    expect(await db.select().from(account).where(eq(account.userId, first.userId))).toHaveLength(1);

    await expect(
      upsertAdminUser(db, { email: "bad", role: "owner", password: PASSWORD }),
    ).rejects.toThrow(/email/i);
    await expect(
      upsertAdminUser(db, { email: "x@example.com", role: "owner", password: "short" }),
    ).rejects.toThrow(/12/);
    await expect(
      upsertAdminUser(db, {
        email: "y@example.com",
        role: "customer" as never,
        password: PASSWORD,
      }),
    ).rejects.toThrow(/Role/);
  });
});
