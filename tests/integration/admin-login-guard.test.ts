import { eq, like } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_LOGIN_ATTEMPT_LIMIT,
  ADMIN_LOGIN_FAILURE_LIMIT,
  ADMIN_LOGIN_IP_FAILURE_LIMIT,
  consumeAdminLoginAttempt,
  isAdminLoginLocked,
  recordFailedAdminLogin,
} from "@/server/auth/admin-login-guard";
import { adminLoginKeys } from "@/server/auth/login-keys";
import { alertOnNewSignIn, isKnownSignInIp } from "@/server/auth/security-alerts";
import { getDb } from "@/server/db";
import { adminAuditLog, notificationOutbox, rateLimits, user } from "@/server/db/schema";
import { setSetting } from "@/server/services/settings";

// Delivery is the sender's job (covered in notify-sender.test.ts); here only what gets queued matters.
vi.mock("@/server/notify/dispatch", () => ({ dispatchOutboxSoon: vi.fn() }));

const db = () => getDb();
const T0 = new Date("2026-11-26T09:30:00.000Z");
const IP = "203.0.113.45";

async function seed() {
  await db()
    .insert(user)
    .values([
      { id: "owner-1", name: "Owner", email: "owner@example.com", role: "owner", twoFactorEnabled: true },
      { id: "admin-1", name: "Admin", email: "staff@example.com", role: "admin", twoFactorEnabled: true },
      { id: "cust-1", name: "Customer", email: "shopper@example.com", role: "customer" },
    ]);
  await setSetting("admin_alert_emails", ["ops@example.com", "owner@example.com"], null);
}

const queued = (template: string) =>
  db().select().from(notificationOutbox).where(eq(notificationOutbox.template, template));
const audit = (action: string) => db().select().from(adminAuditLog).where(eq(adminAuditLog.action, action));

async function failTimes(email: string, n: number, now = T0, ip: string | null = IP) {
  for (let i = 0; i < n; i++) await recordFailedAdminLogin(email, ip, now);
}

beforeEach(async () => {
  await seed();
});

describe("admin sign-in: ten-minute budget per e-mail", () => {
  it("allows 8 attempts of any kind, then refuses; a different address is unaffected; the raw e-mail is never stored", async () => {
    for (let i = 0; i < ADMIN_LOGIN_ATTEMPT_LIMIT.limit; i++) {
      expect(await consumeAdminLoginAttempt("Owner@Example.com", T0)).toBe(true);
    }
    expect(await consumeAdminLoginAttempt("owner@example.com", T0)).toBe(false);
    expect(await consumeAdminLoginAttempt("other@example.com", T0)).toBe(true);
    // The window ends: allowed again.
    expect(await consumeAdminLoginAttempt("owner@example.com", new Date(T0.getTime() + 11 * 60_000))).toBe(true);
    const keys = (await db().select({ key: rateLimits.key }).from(rateLimits)).map((r) => r.key);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key).not.toContain("example.com");
  });
});

describe("admin sign-in: daily failed-password budgets", () => {
  const OTHER_IP = "198.51.100.23";
  /** Wrong passwords spread over `n` different addresses (none reaches its per-address budget). */
  async function failSpread(email: string, n: number, now = T0) {
    for (let i = 0; i < n; i++) await recordFailedAdminLogin(email, `10.0.${Math.floor(i / 200)}.${i % 200}`, now);
  }

  it("locks one address out at its 10th wrong password; the same account still works from another address", async () => {
    const email = "owner@example.com";
    await failTimes(email, ADMIN_LOGIN_IP_FAILURE_LIMIT.limit - 1);
    expect(await isAdminLoginLocked(email, IP, T0)).toBe(false);
    expect(await recordFailedAdminLogin(email, IP, T0)).toEqual({ locked: true, scope: "address" });
    expect(await isAdminLoginLocked(email, IP, T0)).toBe(true);
    expect(await isAdminLoginLocked("OWNER@example.com", IP, T0)).toBe(true);
    // The real person, elsewhere, is not locked out; nor is another account from the attacker's address.
    expect(await isAdminLoginLocked(email, OTHER_IP, T0)).toBe(false);
    expect(await isAdminLoginLocked("staff@example.com", IP, T0)).toBe(false);
    expect(await isAdminLoginLocked(email, IP, new Date(T0.getTime() + 8 * 3600_000))).toBe(true);
  });

  it("locks the account everywhere at 100 wrong passwords spread over many addresses", async () => {
    const email = "owner@example.com";
    await failSpread(email, ADMIN_LOGIN_FAILURE_LIMIT.limit - 1);
    expect(await isAdminLoginLocked(email, OTHER_IP, T0)).toBe(false);
    expect(await recordFailedAdminLogin(email, "192.0.2.200", T0)).toEqual({ locked: true, scope: "account" });
    expect(await isAdminLoginLocked(email, OTHER_IP, T0)).toBe(true);
    expect(await isAdminLoginLocked("staff@example.com", OTHER_IP, T0)).toBe(false);
  });

  it("the locks end with the 24-hour window", async () => {
    await failTimes("owner@example.com", ADMIN_LOGIN_IP_FAILURE_LIMIT.limit);
    // Windows are aligned to UTC midnight; T0 is 09:30 UTC, so the next window starts 14.5 hours later.
    expect(await isAdminLoginLocked("owner@example.com", IP, new Date("2026-11-26T23:59:59.000Z"))).toBe(true);
    expect(await isAdminLoginLocked("owner@example.com", IP, new Date("2026-11-27T00:00:00.000Z"))).toBe(false);
  });

  it("only failures count: reading the budgets never uses them up", async () => {
    for (let i = 0; i < 50; i++) await isAdminLoginLocked("owner@example.com", IP, T0);
    expect(await isAdminLoginLocked("owner@example.com", IP, T0)).toBe(false);
    const rows = await db().select().from(rateLimits).where(like(rateLimits.key, "admin-login-fail%"));
    expect(rows).toHaveLength(0);
  });

  it("an owner unlocks early by deleting the rows by key prefix (address locks included)", async () => {
    await failTimes("owner@example.com", ADMIN_LOGIN_IP_FAILURE_LIMIT.limit);
    expect(await isAdminLoginLocked("owner@example.com", IP, T0)).toBe(true);
    const digest = adminLoginKeys("owner@example.com").failures.split(":")[1]!;
    await db().delete(rateLimits).where(like(rateLimits.key, `admin-login-%:${digest}%`));
    expect(await isAdminLoginLocked("owner@example.com", IP, T0)).toBe(false);
  });
});

describe("admin sign-in: lock alerts", () => {
  it("an address lock on an admin account: one audit row and one e-mail each to the alert list and the account, once per window", async () => {
    await failTimes("staff@example.com", ADMIN_LOGIN_IP_FAILURE_LIMIT.limit + 5);
    await failTimes("staff@example.com", ADMIN_LOGIN_IP_FAILURE_LIMIT.limit, T0, "198.51.100.77"); // a second address: no second alert

    const mails = await queued("admin_login_locked");
    expect(mails.map((m) => m.to).sort()).toEqual(["ops@example.com", "owner@example.com", "staff@example.com"]);
    for (const m of mails) {
      expect(m.payload).toMatchObject({ account: "staff@example.com", scope: "address", failures: 10, ip: IP });
      expect((m.payload as { lockedUntil: string }).lockedUntil).toBe("2026-11-27T00:00:00.000Z");
      expect(JSON.stringify(m.payload)).not.toMatch(/password/i);
    }
    const rows = await audit("admin.login_locked");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: "user", entityId: "admin-1", ip: IP, actorId: null });
  });

  it("the account-wide lock alerts too, even after an address lock already alerted that window", async () => {
    await failTimes("staff@example.com", ADMIN_LOGIN_IP_FAILURE_LIMIT.limit);
    for (let i = 0; i < ADMIN_LOGIN_FAILURE_LIMIT.limit; i++) {
      await recordFailedAdminLogin("staff@example.com", `10.1.${Math.floor(i / 200)}.${i % 200}`, T0);
    }
    const scopes = (await queued("admin_login_locked")).map((m) => (m.payload as { scope: string }).scope);
    expect(new Set(scopes)).toEqual(new Set(["address", "account"]));
    expect(await audit("admin.login_locked")).toHaveLength(2);
  });

  it("the account's own address is not mailed twice when it is also on the alert list", async () => {
    await failTimes("owner@example.com", ADMIN_LOGIN_IP_FAILURE_LIMIT.limit);
    const mails = await queued("admin_login_locked");
    expect(mails.map((m) => m.to).sort()).toEqual(["ops@example.com", "owner@example.com"]);
  });

  it("alerts again in the next window", async () => {
    await failTimes("staff@example.com", ADMIN_LOGIN_IP_FAILURE_LIMIT.limit);
    await failTimes("staff@example.com", ADMIN_LOGIN_IP_FAILURE_LIMIT.limit, new Date("2026-11-27T10:00:00.000Z"));
    expect(await audit("admin.login_locked")).toHaveLength(2);
  });

  it("for an unknown address or a customer: locks, but writes no audit row and sends nothing", async () => {
    await failTimes("ghost@example.com", ADMIN_LOGIN_IP_FAILURE_LIMIT.limit);
    await failTimes("shopper@example.com", ADMIN_LOGIN_IP_FAILURE_LIMIT.limit);
    expect(await isAdminLoginLocked("ghost@example.com", IP, T0)).toBe(true);
    expect(await isAdminLoginLocked("shopper@example.com", IP, T0)).toBe(true);
    expect(await queued("admin_login_locked")).toHaveLength(0);
    expect(await audit("admin.login_locked")).toHaveLength(0);
  });
});

describe("new sign-in alert", () => {
  const input = {
    userId: "admin-1",
    email: "staff@example.com",
    role: "admin",
    ip: IP,
    userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    now: T0,
  };
  const loggedIn = (ip: string | null, daysAgo: number, userId = "admin-1", action = "admin.login") =>
    db()
      .insert(adminAuditLog)
      .values({
        actorId: userId,
        action,
        entity: "user",
        entityId: userId,
        ip,
        createdAt: new Date(T0.getTime() - daysAgo * 86_400_000),
      });

  it("alerts the account holder about an address never seen before, with the time, IP and (truncated) browser", async () => {
    expect(await alertOnNewSignIn(db(), { ...input, userAgent: `Agent ${"x".repeat(400)}` })).toBe(true);
    const mails = await queued("admin_new_sign_in");
    expect(mails.map((m) => m.to)).toEqual(["staff@example.com"]);
    const payload = mails[0]!.payload as { ip: string; at: string; userAgent: string; account: string };
    expect(payload).toMatchObject({ ip: IP, at: T0.toISOString(), account: "staff@example.com" });
    expect(payload.userAgent).toHaveLength(200);
  });

  it("is quiet for an address with a completed sign-in in the last 30 days", async () => {
    await loggedIn(IP, 29);
    expect(await isKnownSignInIp(db(), "admin-1", IP, T0)).toBe(true);
    expect(await alertOnNewSignIn(db(), input)).toBe(false);
    expect(await queued("admin_new_sign_in")).toHaveLength(0);
  });

  it("is loud again once the last sign-in from that address is older than 30 days", async () => {
    await loggedIn(IP, 31); // the audit log is append-only: old rows cannot be removed, they just age out
    expect(await isKnownSignInIp(db(), "admin-1", IP, T0)).toBe(false);
    expect(await alertOnNewSignIn(db(), input)).toBe(true);
  });

  it("only that user's admin.login rows from that same address count", async () => {
    await loggedIn("198.51.100.9", 1); // other address
    await loggedIn(IP, 1, "owner-1"); // other user
    await loggedIn(IP, 1, "admin-1", "admin.logout"); // not a completed sign-in
    await loggedIn(IP, 1, "admin-1", "admin.login_locked");
    expect(await alertOnNewSignIn(db(), input)).toBe(true);
  });

  it("an owner's sign-in also goes to the alert list, without duplicates", async () => {
    await alertOnNewSignIn(db(), { ...input, userId: "owner-1", email: "owner@example.com", role: "owner" });
    expect((await queued("admin_new_sign_in")).map((m) => m.to).sort()).toEqual(["ops@example.com", "owner@example.com"]);
  });

  it("a request with no address still alerts (it cannot be matched to a known one)", async () => {
    expect(await alertOnNewSignIn(db(), { ...input, ip: null, userAgent: null })).toBe(true);
    expect((await queued("admin_new_sign_in"))[0]!.payload).toMatchObject({ ip: null, userAgent: null });
  });

  it("never throws: a failure while queueing is swallowed and logged by error name only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = new Proxy(db(), {
      get(target, prop, receiver) {
        if (prop === "transaction") return () => Promise.reject(new TypeError("secret detail"));
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    await expect(alertOnNewSignIn(broken, input)).resolves.toBe(false);
    expect(log).toHaveBeenCalledWith("new sign-in alert failed:", "TypeError");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret detail");
    log.mockRestore();
  });
});
