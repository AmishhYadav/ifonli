import { verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { upsertAdminUser } from "@/server/auth/admin-user";
import { getDb } from "@/server/db";
import { account, adminAuditLog, session, twoFactor, user } from "@/server/db/schema";
import { AdminInputError } from "@/server/services/admin/products";
import {
  changeStaffRole,
  createStaffUser,
  listStaffUsers,
  resetStaffPassword,
  resetStaffTwoFactor,
  revokeStaffSessions,
  setStaffBanned,
} from "@/server/services/admin/users";

const db = () => getDb();
const owner = { id: "owner-1", role: "owner" };
const owner2 = { id: "owner-2", role: "owner" };
const admin = { id: "admin-1", role: "admin" };

async function seed() {
  await db()
    .insert(user)
    .values([
      {
        id: "owner-1",
        name: "Owner One",
        email: "owner1@example.com",
        role: "owner",
        twoFactorEnabled: true,
      },
      {
        id: "owner-2",
        name: "Owner Two",
        email: "owner2@example.com",
        role: "owner",
        twoFactorEnabled: true,
      },
      {
        id: "admin-1",
        name: "Admin",
        email: "admin@example.com",
        role: "admin",
        twoFactorEnabled: true,
      },
      { id: "ful-1", name: "Packer", email: "ful@example.com", role: "fulfilment" },
      { id: "cust-1", name: "Customer", email: "cust@example.com", role: "customer" },
    ]);
}

async function addSession(userId: string, expired = false) {
  await db()
    .insert(session)
    .values({
      id: crypto.randomUUID(),
      token: crypto.randomUUID(),
      userId,
      expiresAt: new Date(Date.now() + (expired ? -1 : 1) * 3600_000),
    });
}

const sessionsOf = async (userId: string) =>
  (await db().select().from(session).where(eq(session.userId, userId))).length;

describe("admin users: listing", () => {
  it("lists staff only (never customers) with 2FA, ban state and session counts", async () => {
    await seed();
    await addSession("admin-1");
    await addSession("admin-1");
    await addSession("admin-1", true);
    await db()
      .update(user)
      .set({ banned: true, banReason: "left the company" })
      .where(eq(user.id, "ful-1"));
    const rows = await listStaffUsers(db());
    expect(rows.map((r) => r.email).sort()).toEqual([
      "admin@example.com",
      "ful@example.com",
      "owner1@example.com",
      "owner2@example.com",
    ]);
    expect(rows.find((r) => r.id === "admin-1")).toMatchObject({
      activeSessions: 2,
      twoFactorEnabled: true,
      banned: false,
    });
    expect(rows.find((r) => r.id === "admin-1")?.lastSignInAt).toBeInstanceOf(Date);
    expect(rows.find((r) => r.id === "ful-1")).toMatchObject({
      banned: true,
      banReason: "left the company",
      twoFactorEnabled: false,
    });
  });
});

describe("admin users: create", () => {
  it("creates a staff account with a generated temporary password that can sign in (credential account)", async () => {
    await seed();
    const out = await createStaffUser(
      db(),
      { name: " New Admin ", email: " New.Admin@Example.com ", role: "admin" },
      owner,
    );
    expect(out.email).toBe("new.admin@example.com");
    expect(out.tempPassword).toMatch(/^[A-Za-z0-9_-]{20}$/);
    const [u] = await db().select().from(user).where(eq(user.id, out.id));
    expect(u).toMatchObject({
      role: "admin",
      name: "New Admin",
      emailVerified: true,
      twoFactorEnabled: false,
      banned: false,
    });
    const [acct] = await db()
      .select()
      .from(account)
      .where(and(eq(account.userId, out.id), eq(account.providerId, "credential")));
    expect(await verifyPassword({ hash: acct!.password!, password: out.tempPassword! })).toBe(true);
    const [audit] = await db()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "user.create"));
    expect(audit?.diff).toEqual({
      email: "new.admin@example.com",
      name: "New Admin",
      role: "admin",
    });
    expect(JSON.stringify(audit)).not.toContain(out.tempPassword!);
  });

  it("accepts a chosen password (not echoed back) and rejects short ones, bad roles, duplicates", async () => {
    await seed();
    const out = await createStaffUser(
      db(),
      {
        name: "Fulfil",
        email: "new.ful@example.com",
        role: "fulfilment",
        password: "a-long-enough-password",
      },
      owner,
    );
    expect(out.tempPassword).toBeNull();
    await expect(
      createStaffUser(
        db(),
        { name: "X", email: "x@example.com", role: "admin", password: "short" },
        owner,
      ),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      createStaffUser(db(), { name: "X", email: "x@example.com", role: "customer" }, owner),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      createStaffUser(db(), { name: "X", email: "nope", role: "admin" }, owner),
    ).rejects.toBeInstanceOf(ZodError);
    // Existing accounts (customer or staff) are never silently converted.
    await expect(
      createStaffUser(db(), { name: "X", email: "CUST@example.com", role: "admin" }, owner),
    ).rejects.toThrow(/already exists/);
    await expect(
      createStaffUser(db(), { name: "X", email: "admin@example.com", role: "owner" }, owner),
    ).rejects.toThrow(/already exists/);
    expect((await db().select().from(user).where(eq(user.id, "cust-1")))[0]?.role).toBe("customer");
  });

  it("is owner-only", async () => {
    await seed();
    await expect(
      createStaffUser(db(), { name: "X", email: "x@example.com", role: "admin" }, admin),
    ).rejects.toThrow(/Forbidden/);
  });
});

describe("admin users: role changes", () => {
  it("changes a role, signs the person out so it applies now, and audits", async () => {
    await seed();
    await addSession("ful-1");
    await changeStaffRole(db(), "ful-1", "admin", owner);
    expect((await db().select().from(user).where(eq(user.id, "ful-1")))[0]?.role).toBe("admin");
    expect(await sessionsOf("ful-1")).toBe(0);
    const [audit] = await db()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "user.role"));
    expect(audit?.diff).toEqual({
      email: "ful@example.com",
      role: { from: "fulfilment", to: "admin" },
    });
    await changeStaffRole(db(), "ful-1", "admin", owner); // unchanged: no-op
    expect(await db().select().from(adminAuditLog)).toHaveLength(1);
  });

  it("an owner cannot change their own role", async () => {
    await seed();
    await expect(changeStaffRole(db(), "owner-1", "admin", owner)).rejects.toThrow(
      /your own account/,
    );
    expect((await db().select().from(user).where(eq(user.id, "owner-1")))[0]?.role).toBe("owner");
  });

  it("another owner can be demoted while a second active owner remains, never the last one", async () => {
    await seed();
    await changeStaffRole(db(), "owner-2", "admin", owner);
    // owner-1 is now the only owner; a demotion by another owner (simulated actor) is refused.
    await expect(changeStaffRole(db(), "owner-1", "admin", owner2)).rejects.toThrow(
      /at least one active owner/,
    );
    expect((await db().select().from(user).where(eq(user.id, "owner-1")))[0]?.role).toBe("owner");
  });

  it("a banned owner does not count towards the minimum", async () => {
    await seed();
    await db().update(user).set({ banned: true }).where(eq(user.id, "owner-2"));
    await expect(
      changeStaffRole(db(), "owner-1", "admin", { id: "owner-9", role: "owner" }),
    ).rejects.toThrow(/at least one active owner/);
  });

  it("only staff accounts are managed; customers and unknown ids are not found", async () => {
    await seed();
    await expect(changeStaffRole(db(), "cust-1", "admin", owner)).rejects.toThrow(/not found/);
    await expect(changeStaffRole(db(), "nobody", "admin", owner)).rejects.toBeInstanceOf(
      AdminInputError,
    );
    await expect(changeStaffRole(db(), "ful-1", "customer", owner)).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(changeStaffRole(db(), "ful-1", "admin", admin)).rejects.toThrow(/Forbidden/);
  });
});

describe("admin users: ban, sessions, 2FA, password", () => {
  it("bans (deactivates) and unbans; ban signs the person out", async () => {
    await seed();
    await addSession("admin-1");
    await setStaffBanned(db(), "admin-1", true, "  left  ", owner);
    expect((await db().select().from(user).where(eq(user.id, "admin-1")))[0]).toMatchObject({
      banned: true,
      banReason: "left",
    });
    expect(await sessionsOf("admin-1")).toBe(0);
    await setStaffBanned(db(), "admin-1", false, null, owner);
    expect((await db().select().from(user).where(eq(user.id, "admin-1")))[0]).toMatchObject({
      banned: false,
      banReason: null,
    });
    const actions = (await db().select().from(adminAuditLog)).map((r) => r.action);
    expect(actions).toEqual(["user.ban", "user.unban"]);
  });

  it("an owner cannot ban themselves or the last active owner", async () => {
    await seed();
    await expect(setStaffBanned(db(), "owner-1", true, null, owner)).rejects.toThrow(
      /your own account/,
    );
    await setStaffBanned(db(), "owner-2", true, null, owner); // owner-1 stays active
    await expect(setStaffBanned(db(), "owner-1", true, null, owner2)).rejects.toThrow(
      /at least one active owner/,
    );
    // Unbanning yourself is not blocked by the self rule (a banned owner cannot act anyway), and re-enables.
    await setStaffBanned(db(), "owner-2", false, null, owner);
    await setStaffBanned(db(), "owner-1", true, null, owner2);
    expect((await db().select().from(user).where(eq(user.id, "owner-1")))[0]?.banned).toBe(true);
  });

  it("revokes all sessions of someone else, but not your own", async () => {
    await seed();
    await addSession("admin-1");
    await addSession("admin-1");
    await addSession("ful-1");
    expect(await revokeStaffSessions(db(), "admin-1", owner)).toEqual({ revoked: 2 });
    expect(await sessionsOf("admin-1")).toBe(0);
    expect(await sessionsOf("ful-1")).toBe(1);
    await expect(revokeStaffSessions(db(), "owner-1", owner)).rejects.toThrow(/your own account/);
    await expect(revokeStaffSessions(db(), "admin-1", admin)).rejects.toThrow(/Forbidden/);
  });

  it("resets 2FA: drops the secret, flips the flag, signs out; re-enrolment is forced at next login", async () => {
    await seed();
    await db()
      .insert(twoFactor)
      .values({ id: "tf-1", userId: "admin-1", secret: "s", backupCodes: "b" });
    await addSession("admin-1");
    await resetStaffTwoFactor(db(), "admin-1", owner);
    expect(
      (await db().select().from(user).where(eq(user.id, "admin-1")))[0]?.twoFactorEnabled,
    ).toBe(false);
    expect(await db().select().from(twoFactor).where(eq(twoFactor.userId, "admin-1"))).toHaveLength(
      0,
    );
    expect(await sessionsOf("admin-1")).toBe(0);
    await expect(resetStaffTwoFactor(db(), "owner-1", owner)).rejects.toThrow(/your own account/);
    await expect(resetStaffTwoFactor(db(), "cust-1", owner)).rejects.toThrow(/not found/);
    await expect(resetStaffTwoFactor(db(), "admin-1", admin)).rejects.toThrow(/Forbidden/);
  });

  it("resets the password without unbanning or changing the role", async () => {
    await seed();
    await upsertAdminUser(db(), {
      email: "admin@example.com",
      role: "admin",
      password: "original-password-123",
    });
    await db().update(user).set({ banned: true }).where(eq(user.id, "admin-1"));
    await addSession("admin-1");
    const { tempPassword } = await resetStaffPassword(db(), "admin-1", owner);
    const [acct] = await db().select().from(account).where(eq(account.userId, "admin-1"));
    expect(await verifyPassword({ hash: acct!.password!, password: tempPassword })).toBe(true);
    expect(await verifyPassword({ hash: acct!.password!, password: "original-password-123" })).toBe(
      false,
    );
    expect((await db().select().from(user).where(eq(user.id, "admin-1")))[0]).toMatchObject({
      banned: true,
      role: "admin",
    });
    expect(await sessionsOf("admin-1")).toBe(0);
    const [audit] = await db()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "user.reset_password"));
    expect(JSON.stringify(audit)).not.toContain(tempPassword);
    await expect(resetStaffPassword(db(), "owner-1", owner)).rejects.toThrow(/your own account/);

    // An account without a credential row (created some other way) gets one.
    const second = await resetStaffPassword(db(), "ful-1", owner);
    const [fulAcct] = await db().select().from(account).where(eq(account.userId, "ful-1"));
    expect(await verifyPassword({ hash: fulAcct!.password!, password: second.tempPassword })).toBe(
      true,
    );
  });
});
