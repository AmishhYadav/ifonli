import "server-only";

import { asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { assertCan } from "@/server/auth/permissions";
import { couponRedemptions, coupons, orders, productTypes, products, vibes } from "@/server/db/schema";
import { normalizeCode } from "@/server/domain";
import { writeAudit } from "@/server/services/audit";
import type { DbClient } from "@/server/services/queries/shared";

import { AdminInputError, type AdminActor } from "./products";

/* ------------------------------------------------------------------------------------------ */
/* Input                                                                                      */
/* ------------------------------------------------------------------------------------------ */

const COUPON_KINDS = ["percent", "fixed", "free_shipping"] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];

const optionalDate = z
  .unknown()
  .transform((v, ctx): Date | null => {
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
    const d = v instanceof Date ? v : typeof v === "string" || typeof v === "number" ? new Date(v) : new Date(Number.NaN);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Not a valid date and time" });
      return z.NEVER;
    }
    return d;
  });

const optionalPositiveInt = (what: string) =>
  z
    .number()
    .int(`${what} must be a whole number`)
    .positive(`${what} must be at least 1`)
    .nullish()
    .transform((v) => v ?? null);

const slugList = z.array(z.string().trim().min(1).max(80)).max(50).default([]);
const idList = z.array(z.uuid()).max(200).default([]);

/** Storage units: percent = basis points (1000 = 10%), fixed = paise, free_shipping = 0. */
export const couponInputSchema = z
  .object({
    code: z
      .string()
      .transform((v) => normalizeCode(v))
      .pipe(
        z
          .string()
          .min(3, "At least 3 characters")
          .max(32, "At most 32 characters")
          .regex(/^[A-Z0-9][A-Z0-9_-]*$/, "Letters, numbers, - and _ only"),
      ),
    kind: z.enum(COUPON_KINDS),
    value: z.number().int("Whole numbers only").min(0).max(100_000_000).default(0),
    startsAt: optionalDate.default(null),
    endsAt: optionalDate.default(null),
    minSubtotalPaise: z.number().int().min(0, "Cannot be negative").max(100_000_000).default(0),
    maxDiscountPaise: optionalPositiveInt("The cap"),
    usageLimit: optionalPositiveInt("The usage limit"),
    perCustomerLimit: optionalPositiveInt("The per-customer limit"),
    scope: z
      .object({
        vibes: slugList,
        types: slugList,
        products: idList,
        excludeProducts: idList,
      })
      .default({ vibes: [], types: [], products: [], excludeProducts: [] }),
    active: z.boolean().default(true),
  })
  .superRefine((c, ctx) => {
    if (c.kind === "percent" && (c.value < 1 || c.value > 10_000)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "A percentage must be between 0.01% and 100%" });
    }
    if (c.kind === "fixed" && c.value < 1) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter an amount above 0" });
    }
    if (c.startsAt && c.endsAt && c.endsAt.getTime() <= c.startsAt.getTime()) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The end must be after the start" });
    }
    if (c.usageLimit !== null && c.perCustomerLimit !== null && c.perCustomerLimit > c.usageLimit) {
      ctx.addIssue({
        code: "custom",
        path: ["perCustomerLimit"],
        message: "Per-customer limit can't exceed the total usage limit",
      });
    }
    if (c.kind === "free_shipping" && c.maxDiscountPaise !== null) {
      ctx.addIssue({ code: "custom", path: ["maxDiscountPaise"], message: "A free-shipping code has no discount to cap" });
    }
    const overlap = c.scope.products.filter((p) => c.scope.excludeProducts.includes(p));
    if (overlap.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["scope", "excludeProducts"],
        message: "A product can't be both included and excluded",
      });
    }
  })
  .transform((c) => ({ ...c, value: c.kind === "free_shipping" ? 0 : c.value }));

export type CouponInput = z.output<typeof couponInputSchema>;

function fieldIssue(path: (string | number)[], message: string): z.ZodError {
  return new z.ZodError([{ code: "custom", path, message, input: undefined }]);
}

export class CouponNotFoundError extends AdminInputError {
  constructor() {
    super("That coupon no longer exists.");
    this.name = "CouponNotFoundError";
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Reads                                                                                      */
/* ------------------------------------------------------------------------------------------ */

export interface CouponStats {
  reserved: number;
  confirmed: number;
  released: number;
  /** Order value (total) of orders with a confirmed redemption. */
  revenuePaise: number;
  /** Discount given on those orders. */
  discountPaise: number;
}

export type CouponState = "active" | "scheduled" | "expired" | "exhausted" | "inactive";

export interface CouponRow {
  id: string;
  code: string;
  kind: CouponKind;
  value: number;
  startsAt: Date | null;
  endsAt: Date | null;
  minSubtotalPaise: number;
  maxDiscountPaise: number | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  scope: { vibes: string[]; types: string[]; products: string[]; excludeProducts: string[] };
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  stats: CouponStats;
  state: CouponState;
}

const EMPTY_STATS: CouponStats = { reserved: 0, confirmed: 0, released: 0, revenuePaise: 0, discountPaise: 0 };

function normalizeScope(raw: unknown): CouponRow["scope"] {
  const o = (raw ?? {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    vibes: list(o.vibes),
    types: list(o.types),
    products: list(o.products),
    excludeProducts: list(o.excludeProducts),
  };
}

export function couponState(
  c: Pick<CouponRow, "active" | "startsAt" | "endsAt" | "usageLimit"> & { counting: number },
  now: Date,
): CouponState {
  if (!c.active) return "inactive";
  if (c.endsAt && now.getTime() > c.endsAt.getTime()) return "expired";
  if (c.startsAt && now.getTime() < c.startsAt.getTime()) return "scheduled";
  if (c.usageLimit !== null && c.counting >= c.usageLimit) return "exhausted";
  return "active";
}

async function loadStats(db: DbClient, couponIds?: string[]): Promise<Map<string, CouponStats>> {
  if (couponIds && couponIds.length === 0) return new Map();
  const rows = await db
    .select({
      couponId: couponRedemptions.couponId,
      status: couponRedemptions.status,
      n: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${orders.totalPaise}), 0)::float8`,
      discount: sql<number>`coalesce(sum(${orders.discountPaise}), 0)::float8`,
    })
    .from(couponRedemptions)
    .innerJoin(orders, eq(orders.id, couponRedemptions.orderId))
    .where(couponIds ? inArray(couponRedemptions.couponId, couponIds) : undefined)
    .groupBy(couponRedemptions.couponId, couponRedemptions.status);
  const out = new Map<string, CouponStats>();
  for (const r of rows) {
    const s = out.get(r.couponId) ?? { ...EMPTY_STATS };
    s[r.status] = r.n;
    if (r.status === "confirmed") {
      s.revenuePaise = r.revenue;
      s.discountPaise = r.discount;
    }
    out.set(r.couponId, s);
  }
  return out;
}

function toRow(c: typeof coupons.$inferSelect, stats: CouponStats, now: Date): CouponRow {
  return {
    id: c.id,
    code: c.code,
    kind: c.kind,
    value: c.value,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    minSubtotalPaise: c.minSubtotalPaise,
    maxDiscountPaise: c.maxDiscountPaise,
    usageLimit: c.usageLimit,
    perCustomerLimit: c.perCustomerLimit,
    scope: normalizeScope(c.scope),
    active: c.active,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    stats,
    state: couponState({ ...c, counting: stats.reserved + stats.confirmed }, now),
  };
}

export async function listCoupons(db: DbClient, actor: Pick<AdminActor, "role">, now: Date = new Date()): Promise<CouponRow[]> {
  assertCan(actor.role, "coupon:view");
  const [rows, stats] = await Promise.all([
    db.select().from(coupons).orderBy(desc(coupons.active), desc(coupons.createdAt), asc(coupons.code)),
    loadStats(db),
  ]);
  return rows.map((c) => toRow(c, stats.get(c.id) ?? { ...EMPTY_STATS }, now));
}

export interface CouponDetail extends CouponRow {
  recent: { orderId: string; ref: string; email: string; status: string; totalPaise: number; discountPaise: number; createdAt: Date }[];
}

export async function getCoupon(
  db: DbClient,
  id: string,
  actor: Pick<AdminActor, "role">,
  now: Date = new Date(),
): Promise<CouponDetail | null> {
  assertCan(actor.role, "coupon:view");
  const [row] = await db.select().from(coupons).where(eq(coupons.id, id)).limit(1);
  if (!row) return null;
  const [stats, recent] = await Promise.all([
    loadStats(db, [id]),
    db
      .select({
        orderId: orders.id,
        ref: orders.ref,
        email: couponRedemptions.email,
        status: couponRedemptions.status,
        totalPaise: orders.totalPaise,
        discountPaise: orders.discountPaise,
        createdAt: couponRedemptions.createdAt,
      })
      .from(couponRedemptions)
      .innerJoin(orders, eq(orders.id, couponRedemptions.orderId))
      .where(eq(couponRedemptions.couponId, id))
      .orderBy(desc(couponRedemptions.createdAt))
      .limit(10),
  ]);
  return { ...toRow(row, stats.get(id) ?? { ...EMPTY_STATS }, now), recent };
}

export interface CouponFormOptions {
  vibes: { slug: string; name: string }[];
  types: { slug: string; name: string }[];
  products: { id: string; name: string }[];
}

export async function getCouponFormOptions(db: DbClient): Promise<CouponFormOptions> {
  const [v, t, p] = await Promise.all([
    db.select({ slug: vibes.slug, name: vibes.name }).from(vibes).orderBy(asc(vibes.sort)),
    db.select({ slug: productTypes.slug, name: productTypes.name }).from(productTypes).orderBy(asc(productTypes.name)),
    db.select({ id: products.id, name: products.name }).from(products).where(ne(products.status, "archived")).orderBy(asc(products.name)),
  ]);
  return { vibes: v, types: t, products: p };
}

/* ------------------------------------------------------------------------------------------ */
/* Writes                                                                                     */
/* ------------------------------------------------------------------------------------------ */

async function assertScopeRefs(db: DbClient, scope: CouponInput["scope"]): Promise<void> {
  const [v, t, p] = await Promise.all([
    scope.vibes.length ? db.select({ slug: vibes.slug }).from(vibes).where(inArray(vibes.slug, scope.vibes)) : [],
    scope.types.length ? db.select({ slug: productTypes.slug }).from(productTypes).where(inArray(productTypes.slug, scope.types)) : [],
    [...scope.products, ...scope.excludeProducts].length
      ? db.select({ id: products.id }).from(products).where(inArray(products.id, [...scope.products, ...scope.excludeProducts]))
      : [],
  ]);
  const missingVibe = scope.vibes.find((s) => !v.some((r) => r.slug === s));
  if (missingVibe) throw fieldIssue(["scope", "vibes"], `Unknown vibe "${missingVibe}"`);
  const missingType = scope.types.find((s) => !t.some((r) => r.slug === s));
  if (missingType) throw fieldIssue(["scope", "types"], `Unknown product type "${missingType}"`);
  const known = new Set(p.map((r) => r.id));
  if (scope.products.some((id) => !known.has(id))) throw fieldIssue(["scope", "products"], "One of the products no longer exists");
  if (scope.excludeProducts.some((id) => !known.has(id))) {
    throw fieldIssue(["scope", "excludeProducts"], "One of the excluded products no longer exists");
  }
}

async function assertCodeFree(db: DbClient, code: string, exceptId?: string): Promise<void> {
  const rows = await db
    .select({ id: coupons.id })
    .from(coupons)
    .where(sql`lower(${coupons.code}) = lower(${code})`)
    .limit(2);
  if (rows.some((r) => r.id !== exceptId)) {
    throw fieldIssue(["code"], `The code ${code} is already in use (codes are not case-sensitive)`);
  }
}

function values(input: CouponInput) {
  return {
    code: input.code,
    kind: input.kind,
    value: input.value,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    minSubtotalPaise: input.minSubtotalPaise,
    maxDiscountPaise: input.maxDiscountPaise,
    usageLimit: input.usageLimit,
    perCustomerLimit: input.perCustomerLimit,
    scope: input.scope,
    // v1: one coupon per order.
    stackable: false,
    active: input.active,
  };
}

function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  while (cur && typeof cur === "object") {
    if ((cur as { code?: unknown }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

export async function createCoupon(db: DbClient, raw: unknown, actor: AdminActor): Promise<{ id: string; code: string }> {
  assertCan(actor.role, "coupon:manage");
  const input = couponInputSchema.parse(raw);
  await assertScopeRefs(db, input.scope);
  await assertCodeFree(db, input.code);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(coupons).values(values(input)).returning({ id: coupons.id, code: coupons.code });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "coupon.create",
        entity: "coupon",
        entityId: row!.id,
        diff: { code: input.code, kind: input.kind, value: input.value, active: input.active },
        ip: actor.ip,
      });
      return row!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw fieldIssue(["code"], `The code ${input.code} is already in use`);
    throw e;
  }
}

export async function updateCoupon(db: DbClient, id: string, raw: unknown, actor: AdminActor): Promise<{ id: string; code: string }> {
  assertCan(actor.role, "coupon:manage");
  const input = couponInputSchema.parse(raw);
  await assertScopeRefs(db, input.scope);
  await assertCodeFree(db, input.code, id);
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(coupons).where(eq(coupons.id, id)).for("update");
      if (!before) throw new CouponNotFoundError();
      if (before.code.toLowerCase() !== input.code.toLowerCase()) {
        const [used] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(couponRedemptions)
          .where(eq(couponRedemptions.couponId, id));
        if ((used?.n ?? 0) > 0) throw fieldIssue(["code"], "A code that has been used can't be renamed. Deactivate it and create a new one.");
      }
      await tx.update(coupons).set(values(input)).where(eq(coupons.id, id));
      const changed: Record<string, { from: unknown; to: unknown }> = {};
      const next = values(input) as Record<string, unknown>;
      for (const key of Object.keys(next)) {
        const from = (before as Record<string, unknown>)[key];
        const a = JSON.stringify(from instanceof Date ? from.toISOString() : from);
        const bVal = next[key];
        const b = JSON.stringify(bVal instanceof Date ? bVal.toISOString() : bVal);
        if (a !== b) changed[key] = { from, to: bVal };
      }
      await writeAudit(tx, {
        actorId: actor.id,
        action: "coupon.update",
        entity: "coupon",
        entityId: id,
        diff: changed,
        ip: actor.ip,
      });
      return { id, code: input.code };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw fieldIssue(["code"], `The code ${input.code} is already in use`);
    throw e;
  }
}

/** Deactivating stops new use immediately; orders that already hold the code are unaffected. */
export async function setCouponActive(db: DbClient, id: string, active: boolean, actor: AdminActor): Promise<{ id: string; active: boolean }> {
  assertCan(actor.role, "coupon:manage");
  return db.transaction(async (tx) => {
    const [before] = await tx.select({ code: coupons.code, active: coupons.active }).from(coupons).where(eq(coupons.id, id)).for("update");
    if (!before) throw new CouponNotFoundError();
    if (before.active !== active) {
      await tx.update(coupons).set({ active }).where(eq(coupons.id, id));
      await writeAudit(tx, {
        actorId: actor.id,
        action: active ? "coupon.activate" : "coupon.deactivate",
        entity: "coupon",
        entityId: id,
        diff: { code: before.code },
        ip: actor.ip,
      });
    }
    return { id, active };
  });
}
