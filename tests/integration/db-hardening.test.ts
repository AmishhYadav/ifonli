import { readFileSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { adminAuditLog, payments, stockReservations, user } from "@/server/db/schema";

import { makeOrder } from "./catalog-fixture";
import { createSql } from "./helpers/db";
import { makeProduct, makeVariant, PG, pgErrorCode } from "./helpers/factories";

/**
 * Migration 0005: RLS lockdown, append-only audit log, "one paying capture per order", "one
 * reservation per variant per order", and the must-change-password data move. The integration
 * `globalSetup` reproduces hosted Supabase (roles `anon` / `authenticated` exist and receive default
 * grants on everything the owner creates), so the revokes in the migration have real work to undo.
 */
const sql = createSql();
const db = () => getDb();
afterAll(() => sql.end());

const RESTRICT_VIOLATION = "23001";

describe("RLS lockdown", () => {
  it("has row level security enabled on every table in public", async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`;
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it("leaves anon and authenticated with no privilege on any public table, sequence or function", async () => {
    const roles = await sql<{ rolname: string }[]>`
      SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`;
    // The setup creates both; this guards against the branch silently not running.
    expect(roles.map((r) => r.rolname).sort()).toEqual(["anon", "authenticated"]);

    for (const { rolname } of roles) {
      const leaks = await sql<{ relname: string }[]>`
        SELECT c.relname
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'S')
          AND (
            has_table_privilege(${rolname}, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
            OR (c.relkind = 'S' AND has_sequence_privilege(${rolname}, c.oid, 'USAGE, SELECT, UPDATE'))
          )`;
      expect(leaks, `${rolname} tables/sequences`).toEqual([]);

      const fns = await sql<{ proname: string }[]>`
        SELECT p.proname
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                      JOIN pg_roles r ON r.oid = a.grantee WHERE r.rolname = ${rolname})`;
      expect(fns, `${rolname} functions`).toEqual([]);
    }
  });

  it("does not hand the grants back to tables created later", async () => {
    await sql`CREATE TABLE public.rls_probe (id int)`;
    try {
      const [r] = await sql<{ anon: boolean; authed: boolean }[]>`
        SELECT has_table_privilege('anon', 'public.rls_probe', 'SELECT') AS anon,
               has_table_privilege('authenticated', 'public.rls_probe', 'SELECT') AS authed`;
      expect(r).toEqual({ anon: false, authed: false });
    } finally {
      await sql`DROP TABLE public.rls_probe`;
    }
  });
});

describe("admin_audit_log is append-only", () => {
  async function seedAudit() {
    await db().insert(user).values({ id: "staff-1", name: "Staff", email: "staff@example.com", role: "admin" });
    const [row] = await db()
      .insert(adminAuditLog)
      .values({ actorId: "staff-1", action: "product.update", entity: "product", entityId: "p-1", diff: { a: 1 }, ip: "1.2.3.4" })
      .returning();
    return row!;
  }

  it("rejects UPDATE of any column and DELETE", async () => {
    const row = await seedAudit();
    const update = (set: Partial<typeof adminAuditLog.$inferInsert>) =>
      pgErrorCode(db().update(adminAuditLog).set(set).where(eq(adminAuditLog.id, row.id)));
    expect(await update({ action: "product.create" })).toBe(RESTRICT_VIOLATION);
    expect(await update({ diff: { a: 2 } })).toBe(RESTRICT_VIOLATION);
    expect(await update({ createdAt: new Date(0) })).toBe(RESTRICT_VIOLATION);
    // Re-pointing the actor at someone else, or clearing it together with another column, is not the FK action.
    expect(await update({ actorId: "someone-else" })).toBe(RESTRICT_VIOLATION);
    expect(await update({ actorId: null, ip: null })).toBe(RESTRICT_VIOLATION);
    expect(await pgErrorCode(db().delete(adminAuditLog).where(eq(adminAuditLog.id, row.id)))).toBe(
      RESTRICT_VIOLATION,
    );
    const [still] = await db().select().from(adminAuditLog);
    expect(still).toMatchObject({ actorId: "staff-1", action: "product.update", diff: { a: 1 }, ip: "1.2.3.4" });
  });

  it("lets deleting the actor's account clear actor_id (and nothing else), so erasure still works", async () => {
    const row = await seedAudit();
    await db().delete(user).where(eq(user.id, "staff-1"));
    const [after] = await db().select().from(adminAuditLog);
    expect(after).toEqual({ ...row, actorId: null });
  });

  it("still accepts new rows", async () => {
    await db().insert(adminAuditLog).values({ actorId: null, action: "x.y", entity: "x" });
    expect(await db().select().from(adminAuditLog)).toHaveLength(1);
  });
});

describe("at most one paying capture per order", () => {
  const capture = (orderId: string, n: number, raw: unknown = { status: "captured" }) =>
    db().insert(payments).values({
      orderId,
      providerOrderId: `order_${n}`,
      providerPaymentId: `pay_${n}`,
      amountPaise: 100,
      status: "captured",
      raw,
    });

  it("rejects a second captured payment that is not stamped with a disposition", async () => {
    const o = await makeOrder();
    await capture(o.id, 1);
    expect(await pgErrorCode(capture(o.id, 2))).toBe(PG.unique);
    expect(await pgErrorCode(capture(o.id, 3, null))).toBe(PG.unique);
  });

  it("allows the refunded extras the payment flows record (duplicate, no stock, closed order, mismatch)", async () => {
    const o = await makeOrder();
    await capture(o.id, 1);
    await capture(o.id, 2, { disposition: "duplicate" });
    await capture(o.id, 3, { disposition: "no_stock" });
    await capture(o.id, 4, { disposition: "order_closed" });
    expect(await db().select().from(payments).where(eq(payments.orderId, o.id))).toHaveLength(4);
  });

  it("allows any number of created / authorized / failed attempts and one capture per other order", async () => {
    const a = await makeOrder();
    const b = await makeOrder();
    await db().insert(payments).values([
      { orderId: a.id, providerOrderId: "o_1", amountPaise: 100, status: "created" },
      { orderId: a.id, providerOrderId: "o_2", amountPaise: 100, status: "failed" },
      { orderId: a.id, providerOrderId: "o_3", amountPaise: 100, status: "authorized" },
    ]);
    await capture(a.id, 1);
    await capture(b.id, 2);
    expect(await db().select().from(payments)).toHaveLength(5);
  });
});

describe("one stock reservation per variant per order", () => {
  it("rejects a second reservation row for the same order and variant", async () => {
    const product = await makeProduct();
    const variant = await makeVariant(product.id);
    const order = await makeOrder();
    const other = await makeOrder();
    const row = (orderId: string) =>
      db().insert(stockReservations).values({ orderId, variantId: variant.id, qty: 1, expiresAt: new Date(Date.now() + 60_000) });
    await row(order.id);
    expect(await pgErrorCode(row(order.id))).toBe(PG.unique);
    await row(other.id); // another order may reserve the same variant
    // Status changes happen in place, which is how the order flows use the table.
    await db().update(stockReservations).set({ status: "converted" }).where(eq(stockReservations.orderId, order.id));
  });
});

describe("migration 0005: must-change-password markers move to the user column", () => {
  it("copies deadlines to user.password_change_deadline and removes the verification rows", async () => {
    await db().insert(user).values([
      { id: "u-ok", name: "A", email: "a@example.com" },
      { id: "u-bad", name: "B", email: "b@example.com" },
      { id: "u-none", name: "C", email: "c@example.com" },
    ]);
    const deadline = "2030-01-02T03:04:05.678Z";
    const far = new Date("2040-01-01T00:00:00Z");
    await sql`
      INSERT INTO verification (id, identifier, value, expires_at) VALUES
        ('v1', 'must-change-password:u-ok', ${deadline}, ${far}),
        ('v2', 'must-change-password:u-bad', 'garbage', ${far}),
        ('v3', 'must-change-password:ghost', ${deadline}, ${far}),
        ('v4', 'sign-in-otp-a@example.com', '123456:0', ${far})`;

    // Run exactly the statements of the migration that touch the markers.
    const file = readFileSync(path.resolve(process.cwd(), "drizzle/0005_db_hardening.sql"), "utf8");
    const statements = file.split("--> statement-breakpoint").filter((s) => s.includes("must-change-password:"));
    expect(statements).toHaveLength(2);
    for (const s of statements) await sql.unsafe(s);

    const rows = await sql<{ id: string; d: Date | null }[]>`
      SELECT id, password_change_deadline AS d FROM "user" ORDER BY id`;
    expect(rows.find((r) => r.id === "u-ok")!.d!.toISOString()).toBe(deadline);
    expect(rows.find((r) => r.id === "u-bad")!.d!.getTime()).toBe(0); // unreadable = expired, as before
    expect(rows.find((r) => r.id === "u-none")!.d).toBeNull();
    const left = await sql<{ identifier: string }[]>`SELECT identifier FROM verification`;
    expect(left.map((r) => r.identifier)).toEqual(["sign-in-otp-a@example.com"]);
  });
});
