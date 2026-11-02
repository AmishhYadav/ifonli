import "server-only";

import { randomBytes } from "node:crypto";

import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";

import { cartItems, carts, orderItems, orders, stockReservations } from "@/server/db/schema";
import { clampQtyWithReason, type CartLine } from "@/server/domain";

import { validateCoupon, type CouponErrorCode } from "./coupons";
import { resolveImageUrl } from "./media";
import {
  loadCommerceSettings,
  loadVariantSnapshots,
  quoteLines,
  toCartLine,
  type CommerceSettings,
  type Quote,
  type VariantSnapshot,
} from "./pricing";
import type { DbClient } from "./queries/shared";
import { loadVariantStock, type VariantStock } from "./queries/stock";

/** Guest carts are kept this long after their last change. */
export const CART_TTL_DAYS = 30;
const CART_TTL_MS = CART_TTL_DAYS * 86_400_000;

/** Opaque token shape (we only ever mint `newCartToken()` values). */
export const CART_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

export type CartRow = typeof carts.$inferSelect;

export function newCartToken(): string {
  return randomBytes(24).toString("base64url");
}

export type CartNoticeCode =
  | "qty_reduced"
  | "max_per_line"
  | "removed_sold_out"
  | "removed_unavailable"
  | "coupon_removed"
  | "merged_reduced";

export interface CartNotice {
  code: CartNoticeCode;
  variantId?: string;
  /** Human text, shown inline in the cart. */
  message: string;
}

export interface CartViewLine {
  /** Same as `variantId`. */
  lineId: string;
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  /** "Default" for single-variant products. */
  variantTitle: string;
  sku: string;
  image: { path: string; url: string | null; alt: string } | null;
  qty: number;
  unitPricePaise: number;
  mrpPaise: number;
  lineSubtotalPaise: number;
  discountAllocPaise: number;
  lineTotalPaise: number;
  /** Units that can be bought right now (on hand minus live reservations). */
  available: number;
  /** `min(available, max_qty_per_line)`: the most the stepper may offer. */
  maxQty: number;
  lowStock: boolean;
}

export interface CartViewCoupon {
  code: string;
  applied: boolean;
  /** Why it is not applied (e.g. "Add ₹150 more to use SAVE10"), else null. */
  message: string | null;
}

export interface CartViewPricing {
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  totalPaise: number;
  /** GST already included in the total ("Includes ₹X GST"). */
  taxIncludedPaise: number;
  savingsVsMrpPaise: number;
  /** Extra spend for free shipping; 0 once free; null when not offered. */
  freeShippingRemainingPaise: number | null;
  freeThresholdPaise: number | null;
  /** Price-engine hints: "Add ₹X more for free shipping", "You've unlocked free shipping.", ... */
  messages: string[];
}

export interface CartView {
  /** null when the visitor has no cart yet. */
  cartId: string | null;
  /** Bumped on every mutation; part of the checkout idempotency key. */
  version: number;
  lines: CartViewLine[];
  /** Sum of quantities (header badge). */
  itemCount: number;
  coupon: CartViewCoupon | null;
  pricing: CartViewPricing;
  notices: CartNotice[];
  /** Every line is buyable and the cart is not empty. */
  canCheckout: boolean;
}

export type CartErrorCode =
  | "cart_not_found"
  | "invalid_qty"
  | "unavailable"
  | "sold_out"
  | "coupon";

export type CartMutation =
  | { ok: true; notices: CartNotice[] }
  | { ok: false; code: CartErrorCode; message: string; couponCode?: CouponErrorCode };

const fail = (code: CartErrorCode, message: string, couponCode?: CouponErrorCode): CartMutation => ({
  ok: false,
  code,
  message,
  ...(couponCode ? { couponCode } : {}),
});

function displayName(s: Pick<VariantSnapshot, "productName" | "variantTitle">): string {
  return s.variantTitle && s.variantTitle !== "Default"
    ? `${s.productName} (${s.variantTitle})`
    : s.productName;
}

/** Coupon rejections that can fix themselves (add items); anything else is dropped from the cart. */
const RECOVERABLE_COUPON: ReadonlySet<CouponErrorCode> = new Set(["min_subtotal", "no_eligible_items"]);

/* ------------------------------------------------------------------------------------------ */
/* Cart lookup                                                                                */
/* ------------------------------------------------------------------------------------------ */

export async function findCartByToken(
  db: DbClient,
  token: string | null | undefined,
): Promise<CartRow | null> {
  if (!token || !CART_TOKEN_RE.test(token)) return null;
  const [row] = await db.select().from(carts).where(eq(carts.token, token)).limit(1);
  return row ?? null;
}

/** The user's most recently used cart (logged-in visitor without a cookie), or null. */
export async function findUserCart(db: DbClient, userId: string): Promise<CartRow | null> {
  const [row] = await db
    .select()
    .from(carts)
    .where(eq(carts.userId, userId))
    .orderBy(desc(carts.updatedAt))
    .limit(1);
  return row ?? null;
}

/**
 * A cart may be used by a visitor unless it belongs to a DIFFERENT account: a guest cart (no owner)
 * is anyone's, an owned cart only its owner's. This keeps a cart from leaking to the next person on a
 * shared device when a cookie outlives a sign-out.
 */
export function cartUsableBy(cart: Pick<CartRow, "userId">, userId: string | null | undefined): boolean {
  return cart.userId === null || cart.userId === (userId ?? null);
}

/**
 * The cart a request should act on: the cookie cart when this visitor may use it, else (signed in)
 * the user's own most recent cart, else null. A cookie cart owned by someone else is ignored, never
 * read or changed.
 */
export async function resolveViewerCart(
  db: DbClient,
  token: string | null | undefined,
  userId: string | null | undefined,
): Promise<CartRow | null> {
  const byToken = await findCartByToken(db, token);
  if (byToken && cartUsableBy(byToken, userId)) return byToken;
  return userId ? findUserCart(db, userId) : null;
}

/** Total quantity in a cart (header badge). Cheap: no stock or price lookups. */
export async function getCartItemCount(db: DbClient, cartId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${cartItems.qty}), 0)::int` })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId));
  return row?.n ?? 0;
}

/**
 * Finds the visitor's cart or creates one. Resolution order: the cookie token (unless that cart
 * belongs to another account); else (logged in) the user's most recently used cart; else a new cart
 * with a fresh server-minted token (a client-supplied unknown token is never adopted). A logged-in
 * user claims a cart that has no owner yet.
 * Callers must set the cookie to `cart.token` whenever it differs from what they read.
 */
export async function getOrCreateCart(
  db: DbClient,
  token: string | null | undefined,
  userId?: string | null,
  now: Date = new Date(),
): Promise<{ cart: CartRow; created: boolean }> {
  const expiresAt = new Date(now.getTime() + CART_TTL_MS);
  let cart = await resolveViewerCart(db, token, userId);
  if (cart) {
    if (userId && cart.userId === null) {
      const [claimed] = await db
        .update(carts)
        .set({ userId, expiresAt })
        .where(eq(carts.id, cart.id))
        .returning();
      cart = claimed ?? cart;
    }
    return { cart, created: false };
  }
  const [created] = await db
    .insert(carts)
    .values({ token: newCartToken(), userId: userId ?? null, expiresAt })
    .returning();
  return { cart: created!, created: true };
}

/* ------------------------------------------------------------------------------------------ */
/* Reconciliation (re-validate a cart against live catalogue + stock)                          */
/* ------------------------------------------------------------------------------------------ */

interface StoredItem {
  itemId: string;
  variantId: string;
  qty: number;
}

interface ReconciledLine {
  item: StoredItem;
  snap: VariantSnapshot;
  stock: VariantStock;
  /** Quantity after caps (>= 1). */
  qty: number;
  maxQty: number;
}

interface Reconciliation {
  lines: ReconciledLine[];
  /** Stored rows to delete. */
  remove: string[];
  /** Stored rows whose quantity changes. */
  update: { itemId: string; qty: number }[];
  notices: CartNotice[];
}

async function loadStoredItems(db: DbClient, cartId: string): Promise<StoredItem[]> {
  return db
    .select({ itemId: cartItems.id, variantId: cartItems.variantId, qty: cartItems.qty })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId))
    .orderBy(asc(cartItems.createdAt), asc(cartItems.id));
}

/**
 * Plan 7.2: cap each line at `min(available, max_qty_per_line)`, drop lines whose variant / product
 * is inactive or sold out, and say so in human notices. Pure given its inputs.
 */
function reconcile(
  items: readonly StoredItem[],
  snaps: Map<string, VariantSnapshot>,
  stock: Map<string, VariantStock>,
  maxPerLine: number,
): Reconciliation {
  const out: Reconciliation = { lines: [], remove: [], update: [], notices: [] };
  for (const item of items) {
    const snap = snaps.get(item.variantId);
    const st = stock.get(item.variantId);
    if (!snap || !st || !snap.purchasable) {
      out.remove.push(item.itemId);
      out.notices.push({
        code: "removed_unavailable",
        variantId: item.variantId,
        message: `${snap ? displayName(snap) : "An item"} is no longer available, so we removed it from your bag.`,
      });
      continue;
    }
    const clamped = clampQtyWithReason(item.qty, st.available, maxPerLine);
    if (clamped.qty <= 0) {
      out.remove.push(item.itemId);
      out.notices.push({
        code: "removed_sold_out",
        variantId: item.variantId,
        message: `${displayName(snap)} just sold out, so we removed it from your bag.`,
      });
      continue;
    }
    if (clamped.qty !== item.qty) {
      out.update.push({ itemId: item.itemId, qty: clamped.qty });
      out.notices.push(limitNotice(snap, clamped.limitedBy, st.available, maxPerLine));
    }
    out.lines.push({
      item,
      snap,
      stock: st,
      qty: clamped.qty,
      maxQty: Math.min(st.available, maxPerLine),
    });
  }
  return out;
}

function limitNotice(
  snap: VariantSnapshot,
  limitedBy: "available" | "max_per_line" | null,
  available: number,
  maxPerLine: number,
): CartNotice {
  if (limitedBy === "max_per_line") {
    return {
      code: "max_per_line",
      variantId: snap.variantId,
      message: `You can buy up to ${maxPerLine} of ${displayName(snap)} per order — we updated your quantity.`,
    };
  }
  return {
    code: "qty_reduced",
    variantId: snap.variantId,
    message: `Only ${available} left of ${displayName(snap)} — we updated your quantity.`,
  };
}

/**
 * Units held for this cart's own live pending-payment orders, per variant. The next checkout of the
 * cart supersedes those orders (releasing the hold), so the cart must not count them against itself:
 * otherwise dismissing the payment window would shrink or delete the cart's own lines.
 */
async function loadOwnReservedQty(db: DbClient, cartId: string, now: Date): Promise<Map<string, number>> {
  const rows = await db
    .select({ variantId: stockReservations.variantId, qty: sql<number>`sum(${stockReservations.qty})::int` })
    .from(stockReservations)
    .innerJoin(orders, eq(orders.id, stockReservations.orderId))
    .where(
      and(
        eq(orders.cartId, cartId),
        eq(orders.status, "pending_payment"),
        eq(stockReservations.status, "active"),
        gt(stockReservations.expiresAt, now),
      ),
    )
    .groupBy(stockReservations.variantId);
  return new Map(rows.map((r) => [r.variantId, r.qty]));
}

/** `loadVariantStock` with the cart's own reservations given back (see `loadOwnReservedQty`). */
async function loadStockForCart(
  db: DbClient,
  cartId: string,
  variantIds: readonly string[],
  now: Date,
): Promise<VariantStock[]> {
  const [rows, own] = await Promise.all([
    loadVariantStock(db, variantIds, now),
    loadOwnReservedQty(db, cartId, now),
  ]);
  return rows.map((r) => ({ ...r, available: Math.min(r.onHand, r.available + (own.get(r.variantId) ?? 0)) }));
}

async function loadReconciliation(
  db: DbClient,
  cartId: string,
  settings: CommerceSettings,
  now: Date,
): Promise<Reconciliation> {
  const items = await loadStoredItems(db, cartId);
  const ids = items.map((i) => i.variantId);
  const [snaps, stockRows] = await Promise.all([
    loadVariantSnapshots(db, ids),
    loadStockForCart(db, cartId, ids, now),
  ]);
  return reconcile(
    items,
    snaps,
    new Map(stockRows.map((s) => [s.variantId, s])),
    settings.inventory.maxQtyPerLine,
  );
}

/** Persists a reconciliation (qty caps, removals) and bumps the cart version. */
async function applyReconciliation(db: DbClient, cartId: string, r: Reconciliation): Promise<void> {
  if (r.remove.length === 0 && r.update.length === 0) return;
  await db.transaction(async (tx) => {
    await tx.update(carts).set({ version: sql`${carts.version} + 1` }).where(eq(carts.id, cartId));
    if (r.remove.length > 0) {
      await tx.delete(cartItems).where(inArray(cartItems.id, r.remove));
    }
    for (const u of r.update) {
      await tx.update(cartItems).set({ qty: u.qty }).where(eq(cartItems.id, u.itemId));
    }
  });
}

/* ------------------------------------------------------------------------------------------ */
/* View                                                                                       */
/* ------------------------------------------------------------------------------------------ */

const EMPTY_PRICING: CartViewPricing = {
  subtotalPaise: 0,
  discountPaise: 0,
  shippingPaise: 0,
  totalPaise: 0,
  taxIncludedPaise: 0,
  savingsVsMrpPaise: 0,
  freeShippingRemainingPaise: null,
  freeThresholdPaise: null,
  messages: [],
};

export function emptyCartView(): CartView {
  return {
    cartId: null,
    version: 0,
    lines: [],
    itemCount: 0,
    coupon: null,
    pricing: { ...EMPTY_PRICING },
    notices: [],
    canCheckout: false,
  };
}

function safeImageUrl(path: string): string | null {
  try {
    return resolveImageUrl(path);
  } catch {
    return null;
  }
}

export interface CartViewOptions {
  now?: Date;
  /** Customer email, if known: enables the per-customer coupon limit in the displayed discount. */
  email?: string | null;
  /**
   * Write corrections (qty caps, removed lines, dropped coupon) back to the cart. Default true, so a
   * cart never keeps quantities that cannot be bought. Notices describe what changed and are only
   * returned by the call that made the change.
   */
  sync?: boolean;
}

/**
 * The cart as the UI shows it. RE-VALIDATES on every view (plan 7.2): quantities are capped at
 * `min(available, max_qty_per_line)`, inactive / sold-out lines are removed, and a coupon that no
 * longer validates is dropped (or explained, when adding items could fix it). Prices come from the
 * shared pricing function with no payment method (so no COD fee) and no pincode (flat shipping).
 */
export async function getCartView(
  db: DbClient,
  cartId: string,
  opts: CartViewOptions = {},
): Promise<CartView> {
  return (await getCartState(db, cartId, opts)).view;
}

/** A re-validated cart: the UI view plus the priced-engine lines checkout reuses. */
export interface CartState {
  view: CartView;
  /** Effective lines after caps / removals (empty for a missing cart). */
  lines: CartLine[];
  /** Coupon code still on the cart after re-validation (null if dropped). */
  couponCode: string | null;
  settings: CommerceSettings;
}

export async function getCartState(
  db: DbClient,
  cartId: string,
  opts: CartViewOptions = {},
): Promise<CartState> {
  const now = opts.now ?? new Date();
  const [cart] = await db.select().from(carts).where(eq(carts.id, cartId)).limit(1);
  if (!cart) {
    return {
      view: emptyCartView(),
      lines: [],
      couponCode: null,
      settings: await loadCommerceSettings(db),
    };
  }

  const settings = await loadCommerceSettings(db);
  const rec = await loadReconciliation(db, cart.id, settings, now);
  const notices = [...rec.notices];
  let version = cart.version;

  const cartLines: CartLine[] = rec.lines.map((l) => toCartLine(l.snap, l.qty, settings));
  let quote: Quote | null = null;
  let couponCode = cart.couponCode;
  let dropCoupon = false;
  if (cartLines.length > 0 || couponCode) {
    quote = await quoteLines(db, {
      lines: cartLines,
      couponCode,
      email: opts.email,
      paymentMethod: null,
      settings,
      now,
    });
    const c = quote.coupon;
    if (c && !c.applied && c.rejectCode && !RECOVERABLE_COUPON.has(c.rejectCode)) {
      notices.push({
        code: "coupon_removed",
        message: `${c.code} was removed from your bag. ${c.message ?? ""}`.trim(),
      });
      dropCoupon = true;
      couponCode = null;
    }
  }

  if (opts.sync !== false && (rec.remove.length > 0 || rec.update.length > 0 || dropCoupon)) {
    await applyReconciliation(db, cart.id, rec);
    if (dropCoupon) {
      await db.update(carts).set({ couponCode: null }).where(eq(carts.id, cart.id));
    }
    const [fresh] = await db.select({ version: carts.version }).from(carts).where(eq(carts.id, cart.id));
    version = fresh?.version ?? version;
  }

  const price = quote?.price;
  const byLine = new Map(price?.lines.map((l) => [l.lineId, l]) ?? []);
  const lines: CartViewLine[] = rec.lines.map((l) => {
    const p = byLine.get(l.snap.variantId);
    const subtotal = l.snap.pricePaise * l.qty;
    return {
      lineId: l.snap.variantId,
      variantId: l.snap.variantId,
      productId: l.snap.productId,
      productSlug: l.snap.productSlug,
      productName: l.snap.productName,
      variantTitle: l.snap.variantTitle,
      sku: l.snap.sku,
      image: l.snap.image
        ? { path: l.snap.image.path, url: safeImageUrl(l.snap.image.path), alt: l.snap.image.alt }
        : null,
      qty: l.qty,
      unitPricePaise: l.snap.pricePaise,
      mrpPaise: l.snap.mrpPaise,
      lineSubtotalPaise: subtotal,
      discountAllocPaise: p?.discountAllocPaise ?? 0,
      lineTotalPaise: p?.lineTotalPaise ?? subtotal,
      available: l.stock.available,
      maxQty: l.maxQty,
      lowStock:
        l.stock.available <= (l.stock.lowStockThreshold ?? settings.inventory.defaultLowStockThreshold),
    };
  });

  const quoteCoupon = quote?.coupon;
  const coupon: CartViewCoupon | null =
    !dropCoupon && quoteCoupon
      ? { code: quoteCoupon.code, applied: quoteCoupon.applied, message: quoteCoupon.message }
      : null;

  const view: CartView = {
    cartId: cart.id,
    version,
    lines,
    itemCount: lines.reduce((n, l) => n + l.qty, 0),
    coupon,
    pricing: price
      ? {
          subtotalPaise: price.subtotalPaise,
          discountPaise: price.discountPaise,
          shippingPaise: price.shippingPaise,
          totalPaise: price.totalPaise,
          taxIncludedPaise: price.taxIncludedPaise,
          savingsVsMrpPaise: price.savingsVsMrpPaise,
          freeShippingRemainingPaise: price.freeShippingRemainingPaise,
          freeThresholdPaise:
            settings.shipping.freeThresholdPaise > 0 ? settings.shipping.freeThresholdPaise : null,
          messages: price.messages.map((m) => m.text),
        }
      : { ...EMPTY_PRICING },
    notices,
    canCheckout: lines.length > 0,
  };
  return { view, lines: cartLines, couponCode, settings };
}

/** `getCartView` for a cookie token; no cart (or a bogus token) is an empty view, never an error. */
export async function getCartViewByToken(
  db: DbClient,
  token: string | null | undefined,
  opts: CartViewOptions = {},
): Promise<CartView> {
  const cart = await findCartByToken(db, token);
  return cart ? getCartView(db, cart.id, opts) : emptyCartView();
}

/* ------------------------------------------------------------------------------------------ */
/* Mutations (every one bumps `carts.version` first, which also row-locks the cart)             */
/* ------------------------------------------------------------------------------------------ */

const MAX_REQUEST_QTY = 999;

function validQty(qty: unknown, min: number): qty is number {
  return typeof qty === "number" && Number.isInteger(qty) && qty >= min && qty <= MAX_REQUEST_QTY;
}

/** Locks the cart row, bumps the version, and extends its life. Null if the cart is gone. */
async function touchCart(db: DbClient, cartId: string, now: Date): Promise<CartRow | null> {
  const [row] = await db
    .update(carts)
    .set({ version: sql`${carts.version} + 1`, expiresAt: new Date(now.getTime() + CART_TTL_MS) })
    .where(eq(carts.id, cartId))
    .returning();
  return row ?? null;
}

async function setLineQty(
  db: DbClient,
  cartId: string,
  variantId: string,
  requested: number,
  now: Date,
  mode: "add" | "set",
): Promise<CartMutation> {
  return db.transaction(async (tx) => {
    if (!(await touchCart(tx, cartId, now))) {
      return fail("cart_not_found", "We couldn't find your bag. Please refresh the page.");
    }
    const snaps = await loadVariantSnapshots(tx, [variantId]);
    const snap = snaps.get(variantId);
    if (!snap || !snap.purchasable) {
      return fail("unavailable", "Sorry, this item isn't available right now.");
    }
    const [stock] = await loadStockForCart(tx, cartId, [variantId], now);
    const available = stock?.available ?? 0;
    const settings = await loadCommerceSettings(tx);
    const [existing] = await tx
      .select({ id: cartItems.id, qty: cartItems.qty })
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId)));

    const wanted = mode === "add" ? (existing?.qty ?? 0) + requested : requested;
    const clamped = clampQtyWithReason(wanted, available, settings.inventory.maxQtyPerLine);
    if (clamped.qty <= 0) {
      return fail("sold_out", `${displayName(snap)} is sold out right now.`);
    }
    const notices: CartNotice[] = [];
    if (clamped.limitedBy) {
      notices.push(limitNotice(snap, clamped.limitedBy, available, settings.inventory.maxQtyPerLine));
    }
    await tx
      .insert(cartItems)
      .values({ cartId, variantId, qty: clamped.qty })
      .onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.variantId],
        set: { qty: clamped.qty, updatedAt: now },
      });
    return { ok: true, notices } satisfies CartMutation;
  });
}

/** Adds `qty` to the line (creating it), capped at `min(available, max_qty_per_line)`. */
export async function addItem(
  db: DbClient,
  cartId: string,
  input: { variantId: string; qty: number },
  now: Date = new Date(),
): Promise<CartMutation> {
  if (!validQty(input.qty, 1)) return fail("invalid_qty", "Choose a quantity of 1 or more.");
  return setLineQty(db, cartId, input.variantId, input.qty, now, "add");
}

/** Sets the line to exactly `qty` (0 removes it), capped like `addItem`. */
export async function setQuantity(
  db: DbClient,
  cartId: string,
  input: { variantId: string; qty: number },
  now: Date = new Date(),
): Promise<CartMutation> {
  if (!validQty(input.qty, 0)) return fail("invalid_qty", "Choose a valid quantity.");
  if (input.qty === 0) return removeItem(db, cartId, { variantId: input.variantId }, now);
  return setLineQty(db, cartId, input.variantId, input.qty, now, "set");
}

export async function removeItem(
  db: DbClient,
  cartId: string,
  input: { variantId: string },
  now: Date = new Date(),
): Promise<CartMutation> {
  return db.transaction(async (tx) => {
    if (!(await touchCart(tx, cartId, now))) {
      return fail("cart_not_found", "We couldn't find your bag. Please refresh the page.");
    }
    await tx
      .delete(cartItems)
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, input.variantId)));
    return { ok: true, notices: [] } satisfies CartMutation;
  });
}

/**
 * Stores a coupon code on the cart after validating it against the (re-validated) lines. One code
 * per cart: a different code while one is applied is rejected as stacking (re-applying the same
 * code is fine). Returns the specific, human reason on failure.
 */
export async function applyCoupon(
  db: DbClient,
  cartId: string,
  code: string,
  opts: { email?: string | null; now?: Date } = {},
): Promise<CartMutation> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const cart = await touchCart(tx, cartId, now);
    if (!cart) return fail("cart_not_found", "We couldn't find your bag. Please refresh the page.");
    const settings = await loadCommerceSettings(tx);
    const rec = await loadReconciliation(tx, cartId, settings, now);
    const lines = rec.lines.map((l) => toCartLine(l.snap, l.qty, settings));
    if (lines.length === 0) {
      return fail("coupon", "Add something to your bag first, then apply your code.", "no_eligible_items");
    }
    const check = await validateCoupon(tx, code, lines, opts.email, {
      now,
      alreadyAppliedCode: cart.couponCode,
    });
    if (!check.ok) return fail("coupon", check.message, check.code);
    await tx.update(carts).set({ couponCode: check.applied.code }).where(eq(carts.id, cartId));
    return { ok: true, notices: [] } satisfies CartMutation;
  });
}

export async function removeCoupon(
  db: DbClient,
  cartId: string,
  now: Date = new Date(),
): Promise<CartMutation> {
  return db.transaction(async (tx) => {
    if (!(await touchCart(tx, cartId, now))) {
      return fail("cart_not_found", "We couldn't find your bag. Please refresh the page.");
    }
    await tx.update(carts).set({ couponCode: null }).where(eq(carts.id, cartId));
    return { ok: true, notices: [] } satisfies CartMutation;
  });
}

/** Empties the cart and drops its coupon (after a COD order is placed or a payment is captured). */
export async function clearCart(db: DbClient, cartId: string, now: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await touchCart(tx, cartId, now))) return;
    await tx.delete(cartItems).where(eq(cartItems.cartId, cartId));
    await tx.update(carts).set({ couponCode: null }).where(eq(carts.id, cartId));
  });
}

/**
 * Clears the cart an order was placed from (payments call this on capture), but only while the cart
 * is still that order's: a payment that lands late, after the customer moved on to another checkout
 * or kept shopping, must not empty their new basket. "Still the order's" means no newer order was
 * placed from the cart and its lines are exactly the order's lines. No cart = no-op.
 */
export async function clearCartForOrder(db: DbClient, orderId: string): Promise<void> {
  const [row] = await db
    .select({ cartId: orders.cartId, placedAt: orders.placedAt })
    .from(orders)
    .where(eq(orders.id, orderId));
  const cartId = row?.cartId;
  if (!row || !cartId) return;
  await db.transaction(async (tx) => {
    const [cart] = await tx.select({ id: carts.id }).from(carts).where(eq(carts.id, cartId)).for("update");
    if (!cart) return;
    const [newer] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.cartId, cartId), gt(orders.placedAt, row.placedAt)))
      .limit(1);
    if (newer) return;
    const [inCart, bought] = await Promise.all([
      tx.select({ variantId: cartItems.variantId, qty: cartItems.qty }).from(cartItems).where(eq(cartItems.cartId, cartId)),
      tx.select({ variantId: orderItems.variantId, qty: orderItems.qty }).from(orderItems).where(eq(orderItems.orderId, orderId)),
    ]);
    const total = (rows: { variantId: string; qty: number }[]) => {
      const m = new Map<string, number>();
      for (const r of rows) m.set(r.variantId, (m.get(r.variantId) ?? 0) + r.qty);
      return m;
    };
    const a = total(inCart);
    const b = total(bought);
    // The customer changed the basket after placing the order: it is theirs now, leave it alone.
    if (a.size !== b.size || [...b].some(([variantId, qty]) => a.get(variantId) !== qty)) return;
    await clearCart(tx, cartId);
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Merge on login                                                                             */
/* ------------------------------------------------------------------------------------------ */

export interface MergeResult {
  /** Token the browser should now use, or null when there was nothing to merge into. */
  token: string | null;
  merged: boolean;
  notices: CartNotice[];
}

/**
 * Merges the guest cart into the user's cart when they log in. With no existing user cart the
 * guest cart is simply claimed. Otherwise quantities add up (capped by stock and
 * `max_qty_per_line`), a coupon carries over if the user cart has none, the guest cart is deleted
 * and orders pointing at it are re-pointed. The caller must switch the cookie to the returned token.
 */
export async function mergeCarts(
  db: DbClient,
  guestToken: string | null | undefined,
  userId: string,
  now: Date = new Date(),
): Promise<MergeResult> {
  const guest = await findCartByToken(db, guestToken);
  const mine = await findUserCart(db, userId);
  if (!guest) return { token: mine?.token ?? null, merged: false, notices: [] };
  if (guest.userId === userId) return { token: guest.token, merged: false, notices: [] };
  if (guest.userId !== null) return { token: mine?.token ?? null, merged: false, notices: [] };
  const expiresAt = new Date(now.getTime() + CART_TTL_MS);
  if (!mine) {
    await db.update(carts).set({ userId, expiresAt }).where(eq(carts.id, guest.id));
    return { token: guest.token, merged: true, notices: [] };
  }

  const settings = await loadCommerceSettings(db);
  return db.transaction(async (tx) => {
    // Lock both carts in id order (cart mutations lock a single cart, so no deadlock).
    await tx
      .select({ id: carts.id })
      .from(carts)
      .where(inArray(carts.id, [guest.id, mine.id]))
      .orderBy(asc(carts.id))
      .for("update");

    const guestItems = await loadStoredItems(tx, guest.id);
    const mineItems = await loadStoredItems(tx, mine.id);
    const mineByVariant = new Map(mineItems.map((i) => [i.variantId, i]));
    const ids = [...new Set([...guestItems, ...mineItems].map((i) => i.variantId))];
    const [snaps, stockRows] = await Promise.all([
      loadVariantSnapshots(tx, ids),
      loadVariantStock(tx, ids, now),
    ]);
    const stock = new Map(stockRows.map((s) => [s.variantId, s]));
    const notices: CartNotice[] = [];

    for (const g of guestItems) {
      const snap = snaps.get(g.variantId);
      const st = stock.get(g.variantId);
      if (!snap || !st || !snap.purchasable) continue;
      const existing = mineByVariant.get(g.variantId);
      const wanted = (existing?.qty ?? 0) + g.qty;
      const clamped = clampQtyWithReason(wanted, st.available, settings.inventory.maxQtyPerLine);
      if (clamped.qty <= 0) continue;
      if (clamped.qty < wanted) {
        notices.push({
          ...limitNotice(snap, clamped.limitedBy, st.available, settings.inventory.maxQtyPerLine),
          code: "merged_reduced",
        });
      }
      await tx
        .insert(cartItems)
        .values({ cartId: mine.id, variantId: g.variantId, qty: clamped.qty })
        .onConflictDoUpdate({
          target: [cartItems.cartId, cartItems.variantId],
          set: { qty: clamped.qty, updatedAt: now },
        });
    }

    await tx
      .update(carts)
      .set({
        version: sql`${carts.version} + 1`,
        expiresAt,
        couponCode: mine.couponCode ?? guest.couponCode,
      })
      .where(eq(carts.id, mine.id));
    await tx.update(orders).set({ cartId: mine.id }).where(eq(orders.cartId, guest.id));
    await tx.delete(carts).where(eq(carts.id, guest.id));
    return { token: mine.token, merged: true, notices };
  });
}

/** Housekeeping (cron): deletes carts whose `expires_at` has passed. Returns the number removed. */
export async function deleteExpiredCarts(db: DbClient, now: Date = new Date()): Promise<number> {
  const rows = await db
    .delete(carts)
    .where(lt(carts.expiresAt, now))
    .returning({ id: carts.id });
  return rows.length;
}
