import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPasswordChangeState, upsertAdminUser } from "@/server/auth/admin-user";
import { getAuth } from "@/server/auth/auth";
import { getDb } from "@/server/db";
import { account, user, verification } from "@/server/db/schema";
import { createStaffUser, resetStaffPassword, resetStaffTwoFactor } from "@/server/services/admin/users";

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

describe("temporary staff passwords", () => {
  const ownerActor = { id: "owner-actor", role: "owner" };
  const state = (id: string) => getPasswordChangeState(getDb(), id);

  async function seedActor() {
    await getDb().insert(user).values({
      id: ownerActor.id,
      name: "Owner",
      email: "actor@example.com",
      role: "owner",
      twoFactorEnabled: true,
    });
  }

  it("a new staff account must replace its password, and the temporary one expires after a week", async () => {
    await seedActor();
    const created = await createStaffUser(
      getDb(),
      { name: "New Hire", email: "hire@example.com", role: "fulfilment" },
      ownerActor,
    );
    expect(await state(created.id)).toMatchObject({ state: "required" });
    const signIn = () =>
      getAuth().api.signInEmail({ body: { email: "hire@example.com", password: created.tempPassword! } });
    await expect(signIn()).resolves.toBeDefined();

    // Past the deadline the temporary password no longer signs in, with the usual generic error.
    await getDb()
      .update(user)
      .set({ passwordChangeDeadline: new Date(Date.now() - 1000) })
      .where(eq(user.id, created.id));
    expect(await state(created.id)).toEqual({ state: "expired" });
    await expect(signIn()).rejects.toMatchObject({ statusCode: 401, message: "Invalid email or password" });
  });

  it("changing the password mid-enrolment keeps the enrolling session and drops the others", async () => {
    await seedActor();
    const created = await createStaffUser(
      getDb(),
      { name: "New Hire", email: "hire@example.com", role: "admin" },
      ownerActor,
    );
    const auth = getAuth();
    const login = async () => {
      const res = await auth.api.signInEmail({
        body: { email: "hire@example.com", password: created.tempPassword! },
        returnHeaders: true,
      });
      return new Headers({ cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") });
    };
    const attacker = await login();
    const mine = await login();

    // The same calls, in the same order, as `startEnrollmentAction`.
    const enabled = await auth.api.enableTwoFactor({
      body: { password: created.tempPassword!, method: "totp" },
      headers: mine,
    });
    if (enabled.method !== "totp") throw new Error("expected totp");
    const changed = await auth.api.changePassword({
      body: { currentPassword: created.tempPassword!, newPassword: "A-Brand-New-Passphrase-1", revokeOtherSessions: true },
      headers: mine,
      returnHeaders: true,
    });
    const refreshed = new Headers({
      cookie: changed.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
    });

    expect(await auth.api.getSession({ headers: attacker })).toBeNull();
    expect((await auth.api.getSession({ headers: refreshed }))?.user.email).toBe("hire@example.com");
    const secret = new URL(enabled.totpURI).searchParams.get("secret")!;
    await auth.api.verifyTOTP({ body: { code: totp(secret) }, headers: refreshed });
    await expect(
      auth.api.signInEmail({ body: { email: "hire@example.com", password: created.tempPassword! } }),
    ).rejects.toBeDefined();
    await expect(
      auth.api.signInEmail({ body: { email: "hire@example.com", password: "A-Brand-New-Passphrase-1" } }),
    ).resolves.toMatchObject({ twoFactorRedirect: true });
  });

  it("the marker is a column on the user (about a week out), not a row the verification sweep could remove", async () => {
    await seedActor();
    const created = await createStaffUser(
      getDb(),
      { name: "New Hire", email: "hire@example.com", role: "admin" },
      ownerActor,
    );
    const [row] = await getDb().select().from(user).where(eq(user.id, created.id));
    const week = 7 * 24 * 3600 * 1000;
    expect(Math.abs(row!.passwordChangeDeadline!.getTime() - (Date.now() + week))).toBeLessThan(60_000);
    expect(await getDb().select().from(verification)).toHaveLength(0);
    // Clearing it (the script upsert, or a completed change) leaves NULL.
    await upsertAdminUser(getDb(), { email: "hire@example.com", role: "admin", password: PASSWORD });
    const [after] = await getDb().select().from(user).where(eq(user.id, created.id));
    expect(after!.passwordChangeDeadline).toBeNull();
  });

  it("owner resets: only someone still to enrol is asked for a new password; script upserts clear it", async () => {
    await seedActor();
    const db = getDb();
    await db.insert(user).values([
      { id: "u-new", name: "Not Enrolled", email: "new@example.com", role: "admin", twoFactorEnabled: false },
      { id: "u-enrolled", name: "Enrolled", email: "enrolled@example.com", role: "admin", twoFactorEnabled: true },
    ]);
    await resetStaffPassword(db, "u-new", ownerActor);
    await resetStaffPassword(db, "u-enrolled", ownerActor);
    expect(await state("u-new")).toMatchObject({ state: "required" });
    expect(await state("u-enrolled")).toEqual({ state: "none" });

    await resetStaffTwoFactor(db, "u-enrolled", ownerActor);
    expect(await state("u-enrolled")).toMatchObject({ state: "required" });

    await upsertAdminUser(db, { email: "new@example.com", role: "admin", password: PASSWORD });
    expect(await state("u-new")).toEqual({ state: "none" });
  });
});
