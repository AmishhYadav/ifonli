import { like } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { upsertAdminUser } from "@/server/auth/admin-user";
import { getAuth } from "@/server/auth/auth";
import { getDb } from "@/server/db";
import { rateLimits } from "@/server/db/schema";

process.env.BETTER_AUTH_SECRET ||= "integration-test-secret-integration-test-secret";

afterEach(() => vi.restoreAllMocks());

const ipHeaders = (ip: string) => new Headers({ "x-forwarded-for": ip });

/** Asks for a sign-in code as the login action does (in-process) and reads it from the dev sender's log. */
async function requestCode(email: string, ip = "198.51.100.1"): Promise<string> {
  const spy = vi.spyOn(console, "info").mockImplementation(() => {});
  await getAuth().api.sendVerificationOTP({
    body: { email, type: "sign-in" },
    headers: ipHeaders(ip),
  });
  const otp = spy.mock.calls
    .map((c) => String(c[0]))
    .reverse()
    .find((l) => l.includes(email))
    ?.match(/: (\d{6})$/)?.[1];
  spy.mockRestore();
  if (!otp) throw new Error("no OTP logged");
  return otp;
}

const wrongCode = (otp: string) => (otp === "000000" ? "111111" : "000000");

describe("auth rate limits (Postgres-backed, shared across instances)", () => {
  it("caps sign-in codes per email address, whatever the IP", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const auth = getAuth();
    const email = "mailbomb-target@example.com";
    for (let i = 0; i < 5; i++) {
      await auth.api.sendVerificationOTP({
        body: { email, type: "sign-in" },
        headers: ipHeaders(`203.0.113.${i + 1}`),
      });
    }
    await expect(
      auth.api.sendVerificationOTP({ body: { email, type: "sign-in" }, headers: ipHeaders("203.0.113.99") }),
    ).rejects.toMatchObject({ statusCode: 429 });

    // A different address is unaffected.
    await expect(
      auth.api.sendVerificationOTP({
        body: { email: "someone-else@example.com", type: "sign-in" },
        headers: ipHeaders("203.0.113.99"),
      }),
    ).resolves.toBeDefined();
  });

  it("caps sign-in codes per IP across addresses", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const auth = getAuth();
    const send = (n: number) =>
      auth.api.sendVerificationOTP({
        body: { email: `spray-${n}@example.com`, type: "sign-in" },
        headers: ipHeaders("192.0.2.50"),
      });
    for (let i = 0; i < 20; i++) await send(i);
    await expect(send(20)).rejects.toMatchObject({ statusCode: 429 });
    await expect(
      auth.api.sendVerificationOTP({
        body: { email: "spray-0@example.com", type: "sign-in" },
        headers: ipHeaders("192.0.2.51"),
      }),
    ).resolves.toBeDefined();
  });

  it("a stranger's wrong codes cannot lock the real customer out of signing in", async () => {
    const email = "victim@example.com";
    const auth = getAuth();
    const customerIp = "198.51.100.1";
    const stale = await requestCode(email, customerIp);

    // A stranger hammers the address with wrong codes until they are refused (this also burns the
    // code that was sent: Better Auth locks a code after 5 wrong tries).
    const attacker = ipHeaders("203.0.113.200");
    for (let i = 0; i < 8; i++) {
      await expect(
        auth.api.signInEmailOTP({ body: { email, otp: wrongCode(stale) }, headers: attacker }),
      ).rejects.toBeDefined();
    }
    await expect(
      auth.api.signInEmailOTP({ body: { email, otp: wrongCode(stale) }, headers: attacker }),
    ).rejects.toMatchObject({ statusCode: 429 });

    // The customer asks for a new code (the stranger's failures did not use the send budget) and
    // signs in from their own connection (the stranger's failures did not use theirs).
    const fresh = await requestCode(email, customerIp);
    const res = await auth.api.signInEmailOTP({
      body: { email, otp: fresh },
      headers: ipHeaders(customerIp),
    });
    expect(res.user.email).toBe(email);
  });

  it("sending codes does not use up the budget for entering them", async () => {
    const email = "sender@example.com";
    let otp = "";
    for (let i = 0; i < 5; i++) otp = await requestCode(email, "198.51.100.2");
    const res = await getAuth().api.signInEmailOTP({
      body: { email, otp },
      headers: ipHeaders("198.51.100.2"),
    });
    expect(res.user.email).toBe(email);
  });

  it("serves only the session endpoints over HTTP and refuses everything else the same way", async () => {
    await upsertAdminUser(getDb(), { email: "boss@example.com", role: "owner", password: "Correct-Horse-Battery-9" });
    vi.spyOn(console, "info").mockImplementation(() => {});
    const auth = getAuth();
    const post = (path: string, body: unknown) =>
      auth.handler(
        new Request(`http://localhost:3000/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
          body: JSON.stringify(body),
        }),
      );

    // Admin and customer addresses look identical: nobody can tell who is staff.
    const admin = await post("/email-otp/send-verification-otp", { email: "boss@example.com", type: "sign-in" });
    const customer = await post("/email-otp/send-verification-otp", { email: "buyer@example.com", type: "sign-in" });
    expect(admin.status).toBe(404);
    expect(customer.status).toBe(404);
    expect(await admin.text()).toBe(await customer.text());

    for (const [path, body] of [
      ["/sign-in/email", { email: "boss@example.com", password: "Correct-Horse-Battery-9" }],
      ["/sign-in/email-otp", { email: "buyer@example.com", otp: "123456" }],
      ["/two-factor/verify-totp", { code: "123456" }],
      ["/admin/set-role", { userId: "x", role: "owner" }],
      ["/admin/remove-user", { userId: "x" }],
    ] as const) {
      expect((await post(path, body)).status, path).toBe(404);
    }

    const session = await auth.handler(new Request("http://localhost:3000/api/auth/get-session"));
    expect(session.status).toBe(200);
  });

  it("stores the HTTP handler's counters in rate_limits and blocks after the global rule", async () => {
    const call = () =>
      getAuth().handler(
        new Request("http://localhost:3000/api/auth/get-session", {
          headers: { "x-forwarded-for": "198.51.100.8" },
        }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 62; i++) statuses.push((await call()).status);

    expect(statuses.slice(0, 60)).not.toContain(429);
    expect(statuses.slice(60)).toEqual([429, 429]);

    const rows = await getDb().select().from(rateLimits).where(like(rateLimits.key, "ba:%"));
    expect(rows.length).toBeGreaterThan(0);
  });
});
