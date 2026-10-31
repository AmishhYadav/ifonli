import "server-only";

import { and, asc, count, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { assertCan } from "@/server/auth/permissions";
import {
  addresses,
  contactMessages,
  customerProfiles,
  orders,
  session,
  supportCases,
  user,
  wishlistItems,
} from "@/server/db/schema";
import type {
  ContactStatus,
  FulfillmentStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  SupportResolution,
  SupportStatus,
  SupportType,
} from "@/server/domain";
import { writeAudit } from "@/server/services/audit";
import {
  deleteCustomerAccount,
  exportCustomerData,
  exportGuestData,
  type CustomerDataExport,
  type GuestDataExport,
} from "@/server/services/dpdp";
import type { DbClient } from "@/server/services/queries/shared";
import { REPLACEMENT_KEY_PREFIX } from "@/server/services/replacement-orders";

import { COUNTED_STATUSES, UNCOUNTED_PAYMENT } from "./dashboard";
import { AdminInputError, type AdminActor } from "./products";

/**
 * Admin Customers module (plan 11).
 *
 * Who is a "customer"? One person per (lower-cased) e-mail address:
 *  - an ACCOUNT: a `user` row with role `customer` (staff roles never appear here);
 *  - a GUEST: an e-mail that placed at least one real order and has no `user` row at all.
 *
 * Orders are attributed to the person by `lower(coalesce(order.user -> email, order.email))`: an order
 * linked to an account belongs to that account (whatever e-mail was typed at checkout), an unlinked
 * order belongs to whoever owns that e-mail (the account if there is one, the guest otherwise). This is
 * the same rule the storefront uses to show a customer their history (D-ACC-2) and it needs no
 * duplicated customer table. Checkouts that never completed (`pending_payment`, `expired`) never make
 * someone a customer and are left out of the numbers.
 *
 * "Counted sale" = the dashboard's definition: status confirmed/processing/completed, payment not
 * refunded or failed, and not a no-charge replacement order. Order count and lifetime value use it.
 */

export const CUSTOMER_PAGE_SIZE = 25;
export const CUSTOMER_SORTS = ["last_order", "spent", "joined"] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];
export const CUSTOMER_KINDS = ["account", "guest"] as const;
export type CustomerKind = (typeof CUSTOMER_KINDS)[number];

/** The list/detail error an admin can act on ("that customer no longer exists"). */
export class CustomerNotFoundError extends AdminInputError {
  constructor() {
    super("That customer no longer exists, or is not a customer account.");
    this.name = "CustomerNotFoundError";
  }
}

/* ------------------------------------------------------------------------------------------ */
/* References                                                                                 */
/* ------------------------------------------------------------------------------------------ */

const GUEST_REF_RE = /^o-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * URL reference of a customer. An account is its user id. A guest has no id and a URL should not carry
 * an e-mail address, so a guest is referenced by one of its orders (`o-<order id>`): any of their orders
 * leads to the same person.
 */
export const guestRef = (orderId: string): string => `o-${orderId}`;

export type ResolvedCustomer =
  | { kind: "account"; ref: string; account: typeof user.$inferSelect }
  | { kind: "guest"; ref: string; email: string; orderId: string };

/** Finds the customer a URL reference points at, or null (unknown ref, or a staff account). */
export async function resolveCustomer(
  db: DbClient,
  rawRef: string,
): Promise<ResolvedCustomer | null> {
  const ref = rawRef.trim();
  if (!ref || ref.length > 100) return null;

  const guestMatch = GUEST_REF_RE.exec(ref);
  if (guestMatch) {
    const orderId = guestMatch[1]!.toLowerCase();
    const [order] = await db
      .select({ id: orders.id, email: orders.email, userId: orders.userId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) return null;
    // The order may belong to an account (linked, or its e-mail has since become one): follow it.
    const [owner] = await db
      .select()
      .from(user)
      .where(
        order.userId
          ? eq(user.id, order.userId)
          : sql`lower(${user.email}) = ${order.email.toLowerCase()}`,
      )
      .limit(1);
    if (owner) {
      return owner.role === "customer" ? { kind: "account", ref: owner.id, account: owner } : null;
    }
    return {
      kind: "guest",
      ref: guestRef(order.id),
      email: order.email.trim().toLowerCase(),
      orderId: order.id,
    };
  }

  const [account] = await db.select().from(user).where(eq(user.id, ref)).limit(1);
  if (!account || account.role !== "customer") return null;
  return { kind: "account", ref: account.id, account };
}

/* ------------------------------------------------------------------------------------------ */
/* List                                                                                       */
/* ------------------------------------------------------------------------------------------ */

export interface CustomerListFilters {
  /** Matches name (account or shipping name), e-mail and phone. */
  q?: string;
  kind?: CustomerKind;
  sort?: CustomerSort;
  dir?: "asc" | "desc";
}

export interface CustomerListRow {
  ref: string;
  kind: CustomerKind;
  name: string;
  email: string;
  phone: string | null;
  /** Account created, or the guest's first order. */
  joinedAt: Date;
  /** Counted orders (see the module note). */
  orderCount: number;
  /** Sum of the totals of counted orders, in paise. */
  lifetimeValuePaise: number;
  /** Latest real order of any status, or null for an account that never ordered. */
  lastOrderAt: Date | null;
}

export interface CustomerList {
  items: CustomerListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const sqlList = (values: readonly string[]): SQL =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/** The "counted sale" predicate over `orders` (same rule as the dashboard). */
function countedSale(): SQL {
  return sql`(${orders.status} in (${sqlList(COUNTED_STATUSES)}) and ${orders.paymentStatus} not in (${sqlList(UNCOUNTED_PAYMENT)}) and ${orders.idempotencyKey} not like ${`${REPLACEMENT_KEY_PREFIX}%`})`;
}

/** Orders that count as "real" for finding customers: a checkout that never completed does not. */
const REAL_ORDER = sql`${orders.status} not in ('pending_payment', 'expired')`;

/**
 * `people`: one row per customer (accounts + guests) with its order aggregates. Built from a single
 * pass over `orders` (one group-by on the person key) joined to the account list.
 */
function peopleCte(): SQL {
  return sql`
    with base as (
      select lower(coalesce(${user.email}, ${orders.email})) as key,
             ${orders.id} as id,
             ${orders.placedAt} as placed_at,
             ${orders.totalPaise} as total_paise,
             ${countedSale()} as counted,
             ${orders.phone} as phone,
             nullif(btrim(${orders.shippingAddress}->>'name'), '') as ship_name,
             ${orders.email} as email
      from ${orders}
      left join ${user} on ${user.id} = ${orders.userId}
      where ${REAL_ORDER}
    ), agg as (
      select key,
             (count(*) filter (where counted))::int as order_count,
             (coalesce(sum(total_paise) filter (where counted), 0))::float8 as spent,
             max(placed_at) as last_order_at,
             min(placed_at) as first_order_at,
             (array_agg(id order by placed_at desc, id desc))[1] as last_order_id,
             (array_agg(email order by placed_at desc, id desc))[1] as last_email,
             (array_agg(ship_name order by placed_at desc, id desc) filter (where ship_name is not null))[1] as last_name,
             (array_agg(phone order by placed_at desc, id desc) filter (where phone is not null))[1] as last_phone,
             string_agg(distinct ship_name, ' ') as names,
             string_agg(distinct phone, ' ') as phones,
             string_agg(distinct email, ' ') as emails
      from base
      group by key
    ), people as (
      select 'account'::text as kind,
             ${user.id} as ref,
             ${user.name} as name,
             ${user.email} as email,
             coalesce(${customerProfiles.phone}, agg.last_phone) as phone,
             ${user.createdAt} as joined_at,
             coalesce(agg.order_count, 0) as order_count,
             coalesce(agg.spent, 0) as spent,
             agg.last_order_at as last_order_at,
             concat_ws(' ', ${user.name}, ${user.email}, agg.names, agg.emails) as haystack,
             regexp_replace(concat_ws(' ', ${customerProfiles.phone}, agg.phones), '\\D', '', 'g') as phone_digits
      from ${user}
      left join ${customerProfiles} on ${customerProfiles.userId} = ${user.id}
      left join agg on agg.key = lower(${user.email})
      where ${user.role} = 'customer'
      union all
      select 'guest'::text,
             'o-' || agg.last_order_id::text,
             coalesce(agg.last_name, ''),
             agg.last_email,
             agg.last_phone,
             agg.first_order_at,
             agg.order_count,
             agg.spent,
             agg.last_order_at,
             concat_ws(' ', agg.names, agg.emails),
             regexp_replace(coalesce(agg.phones, ''), '\\D', '', 'g')
      from agg
      where not exists (select 1 from ${user} where lower(${user.email}) = agg.key)
    )`;
}

function likePattern(raw: string): string {
  return `%${raw.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

function peopleWhere(f: CustomerListFilters): SQL {
  const conds: SQL[] = [];
  if (f.kind === "account" || f.kind === "guest") conds.push(sql`kind = ${f.kind}`);
  const q = f.q?.trim().slice(0, 100);
  if (q) {
    const digits = q.replace(/\D/g, "");
    const byText = sql`haystack ilike ${likePattern(q)}`;
    conds.push(
      digits.length >= 4 ? sql`(${byText} or phone_digits like ${likePattern(digits)})` : byText,
    );
  }
  return conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;
}

const SORT_COLUMN: Record<CustomerSort, string> = {
  last_order: "last_order_at",
  spent: "spent",
  joined: "joined_at",
};

interface PersonRow extends Record<string, unknown> {
  kind: CustomerKind;
  ref: string;
  name: string;
  email: string;
  phone: string | null;
  joined_ms: number;
  order_count: number;
  spent: number;
  last_order_ms: number | null;
}

/**
 * Server-side paginated list of customers (accounts and guests), searchable and sortable. Default
 * order: most recent order first (customers who never ordered last).
 */
export async function listCustomers(
  db: DbClient,
  params: CustomerListFilters & { page?: number; pageSize?: number } = {},
): Promise<CustomerList> {
  const pageSize = Math.min(100, Math.max(1, Math.trunc(params.pageSize ?? CUSTOMER_PAGE_SIZE)));
  const where = peopleWhere(params);
  const cte = peopleCte();

  const [totalRow] = await db.execute<{ n: number }>(
    sql`${cte} select count(*)::int as n from people ${where}`,
  );
  const total = totalRow?.n ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.trunc(params.page ?? 1) || 1));

  const sort: CustomerSort = params.sort && params.sort in SORT_COLUMN ? params.sort : "last_order";
  const dir = params.dir === "asc" ? "asc" : "desc";
  // The column and direction come from closed whitelists, never from the request.
  const orderBy = sql.raw(`${SORT_COLUMN[sort]} ${dir} nulls last, email asc`);

  const rows = await db.execute<PersonRow>(sql`
    ${cte}
    select kind, ref, name, email, phone, order_count, spent,
           (extract(epoch from joined_at) * 1000)::float8 as joined_ms,
           (extract(epoch from last_order_at) * 1000)::float8 as last_order_ms
    from people
    ${where}
    order by ${orderBy}
    limit ${pageSize} offset ${(page - 1) * pageSize}
  `);

  return {
    items: Array.from(rows, (r) => ({
      ref: r.ref,
      kind: r.kind,
      name: r.name,
      email: r.email,
      phone: r.phone,
      joinedAt: new Date(Number(r.joined_ms)),
      orderCount: Number(r.order_count),
      lifetimeValuePaise: Number(r.spent),
      lastOrderAt: r.last_order_ms === null ? null : new Date(Number(r.last_order_ms)),
    })),
    total,
    page,
    pageSize,
    pageCount,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Detail                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export interface CustomerOrderRow {
  id: string;
  ref: string;
  placedAt: Date;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  paymentMethod: PaymentMethod;
  totalPaise: number;
  /** True for a no-charge replacement order (support). */
  isReplacement: boolean;
  /** True when the order counts toward order count and lifetime value. */
  counted: boolean;
}

export interface CustomerDetail {
  ref: string;
  kind: CustomerKind;
  name: string;
  email: string;
  phone: string | null;
  /** Only for accounts. */
  account: {
    id: string;
    emailVerified: boolean;
    createdAt: Date;
    /** Start of the most recent sign-in session still on record, if any. */
    lastSignInAt: Date | null;
    marketingOptIn: boolean;
    banned: boolean;
  } | null;
  /** Guests: when they first ordered. */
  firstOrderAt: Date | null;
  stats: { orderCount: number; lifetimeValuePaise: number; lastOrderAt: Date | null };
  addresses: {
    id: string;
    name: string;
    phone: string;
    line1: string;
    line2: string | null;
    landmark: string | null;
    city: string;
    state: string;
    pincode: string;
    isDefault: boolean;
  }[];
  orders: CustomerOrderRow[];
  /** More orders than the list shows (it is capped). */
  ordersTotal: number;
  wishlistCount: number;
  supportCases: {
    id: string;
    orderRef: string;
    type: SupportType;
    status: SupportStatus;
    resolution: SupportResolution | null;
    createdAt: Date;
  }[];
  contactMessages: {
    id: string;
    status: ContactStatus;
    orderRef: string | null;
    snippet: string;
    createdAt: Date;
  }[];
  /** Account deletion is for accounts only; guest orders are retained records (D-DPDP-1). */
  canDelete: boolean;
}

const DETAIL_ORDER_LIMIT = 200;
const DETAIL_LIST_LIMIT = 50;

function snippet(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Which orders belong to this person (see the module note). */
function ownedOrdersWhere(c: ResolvedCustomer): SQL {
  const unlinkedByEmail = (email: string) =>
    and(isNull(orders.userId), sql`lower(${orders.email}) = ${email.toLowerCase()}`);
  return (
    c.kind === "account"
      ? or(eq(orders.userId, c.account.id), unlinkedByEmail(c.account.email))
      : unlinkedByEmail(c.email)
  )!;
}

function addressName(address: unknown): string {
  const name = (address as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name.trim() : "";
}

export async function getCustomerDetail(
  db: DbClient,
  rawRef: string,
): Promise<CustomerDetail | null> {
  const customer = await resolveCustomer(db, rawRef);
  if (!customer) return null;

  const email = customer.kind === "account" ? customer.account.email : customer.email;
  const owned = and(ownedOrdersWhere(customer), REAL_ORDER)!;
  const ownedAny = ownedOrdersWhere(customer);

  const [orderRows, [totals], caseRows, messageRows, latest] = await Promise.all([
    db
      .select()
      .from(orders)
      .where(ownedAny)
      .orderBy(desc(orders.placedAt), desc(orders.id))
      .limit(DETAIL_ORDER_LIMIT),
    db
      .select({
        total: count(),
        orderCount: sql<number>`(count(*) filter (where ${countedSale()}))::int`,
        spent: sql<number>`(coalesce(sum(${orders.totalPaise}) filter (where ${countedSale()}), 0))::float8`,
        first: sql<
          number | null
        >`(extract(epoch from min(${orders.placedAt}) filter (where ${REAL_ORDER})) * 1000)::float8`,
        last: sql<
          number | null
        >`(extract(epoch from max(${orders.placedAt}) filter (where ${REAL_ORDER})) * 1000)::float8`,
      })
      .from(orders)
      .where(ownedAny),
    db
      .select({
        id: supportCases.id,
        orderRef: orders.ref,
        type: supportCases.type,
        status: supportCases.status,
        resolution: supportCases.resolution,
        createdAt: supportCases.createdAt,
      })
      .from(supportCases)
      .innerJoin(orders, eq(orders.id, supportCases.orderId))
      .where(ownedAny)
      .orderBy(desc(supportCases.createdAt), desc(supportCases.id))
      .limit(DETAIL_LIST_LIMIT),
    db
      .select({
        id: contactMessages.id,
        status: contactMessages.status,
        orderRef: contactMessages.orderRef,
        message: contactMessages.message,
        createdAt: contactMessages.createdAt,
      })
      .from(contactMessages)
      .where(sql`lower(${contactMessages.email}) = ${email.toLowerCase()}`)
      .orderBy(desc(contactMessages.createdAt), desc(contactMessages.id))
      .limit(DETAIL_LIST_LIMIT),
    // Name and phone as typed on the most recent real order (a guest's only source of both).
    db
      .select({ address: orders.shippingAddress, phone: orders.phone })
      .from(orders)
      .where(owned)
      .orderBy(desc(orders.placedAt), desc(orders.id))
      .limit(1),
  ]);

  const orderViews: CustomerOrderRow[] = orderRows.map((o) => {
    const isReplacement = o.idempotencyKey.startsWith(REPLACEMENT_KEY_PREFIX);
    return {
      id: o.id,
      ref: o.ref,
      placedAt: o.placedAt,
      status: o.status,
      paymentStatus: o.paymentStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      paymentMethod: o.paymentMethod,
      totalPaise: o.totalPaise,
      isReplacement,
      counted:
        (COUNTED_STATUSES as readonly string[]).includes(o.status) &&
        !(UNCOUNTED_PAYMENT as readonly string[]).includes(o.paymentStatus) &&
        !isReplacement,
    };
  });

  const stats = {
    orderCount: totals?.orderCount ?? 0,
    lifetimeValuePaise: Number(totals?.spent ?? 0),
    lastOrderAt: totals?.last != null ? new Date(Number(totals.last)) : null,
  };
  const firstOrderAt = totals?.first != null ? new Date(Number(totals.first)) : null;
  const lastOrder = latest[0];

  const casesView = caseRows.map((c) => ({ ...c }));
  const messagesView = messageRows.map((m) => ({
    id: m.id,
    status: m.status,
    orderRef: m.orderRef,
    snippet: snippet(m.message),
    createdAt: m.createdAt,
  }));

  if (customer.kind === "guest") {
    return {
      ref: customer.ref,
      kind: "guest",
      name: addressName(lastOrder?.address),
      email,
      phone: lastOrder?.phone ?? null,
      account: null,
      firstOrderAt,
      stats,
      addresses: [],
      orders: orderViews,
      ordersTotal: totals?.total ?? orderViews.length,
      wishlistCount: 0,
      supportCases: casesView,
      contactMessages: messagesView,
      canDelete: false,
    };
  }

  const a = customer.account;
  const [[profile], addressRows, [wishlist], [lastSession]] = await Promise.all([
    db.select().from(customerProfiles).where(eq(customerProfiles.userId, a.id)).limit(1),
    db
      .select()
      .from(addresses)
      .where(eq(addresses.userId, a.id))
      .orderBy(desc(addresses.isDefault), asc(addresses.createdAt)),
    db.select({ n: count() }).from(wishlistItems).where(eq(wishlistItems.userId, a.id)),
    db
      .select({
        at: sql<number | null>`(extract(epoch from max(${session.createdAt})) * 1000)::float8`,
      })
      .from(session)
      .where(eq(session.userId, a.id)),
  ]);

  return {
    ref: a.id,
    kind: "account",
    name: a.name,
    email: a.email,
    phone: profile?.phone ?? lastOrder?.phone ?? null,
    account: {
      id: a.id,
      emailVerified: a.emailVerified,
      createdAt: a.createdAt,
      lastSignInAt: lastSession?.at != null ? new Date(Number(lastSession.at)) : null,
      marketingOptIn: profile?.marketingOptIn ?? false,
      banned: a.banned === true,
    },
    firstOrderAt,
    stats,
    addresses: addressRows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      line1: r.line1,
      line2: r.line2,
      landmark: r.landmark,
      city: r.city,
      state: r.state,
      pincode: r.pincode,
      isDefault: r.isDefault,
    })),
    orders: orderViews,
    ordersTotal: totals?.total ?? orderViews.length,
    wishlistCount: wishlist?.n ?? 0,
    supportCases: casesView,
    contactMessages: messagesView,
    canDelete: true,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* DPDP requests                                                                              */
/* ------------------------------------------------------------------------------------------ */

export interface CustomerExportFile {
  filename: string;
  /** Pretty-printed JSON. */
  content: string;
}

/**
 * "Export data" (DPDP access request): reuses `exportCustomerData` for accounts and `exportGuestData`
 * for guests. The export and its audit row (`customer.export`, counts only: no name, e-mail or any
 * of the exported data) commit together, so there is no unaudited export.
 */
export async function exportCustomerForStaff(
  db: DbClient,
  rawRef: string,
  actor: AdminActor,
): Promise<CustomerExportFile> {
  assertCan(actor.role, "customer:export");
  const customer = await resolveCustomer(db, rawRef);
  if (!customer) throw new CustomerNotFoundError();

  return db.transaction(async (tx) => {
    let data: CustomerDataExport | GuestDataExport | null;
    let entity: string;
    let entityId: string;
    let counts: Record<string, number>;
    let filePart: string;
    if (customer.kind === "account") {
      const exported = await exportCustomerData(tx, customer.account.id);
      data = exported;
      entity = "user";
      entityId = customer.account.id;
      filePart = `account-${customer.account.id.slice(0, 8)}`;
      counts = exported
        ? {
            orders: exported.orders.length,
            addresses: exported.addresses.length,
            wishlistItems: exported.wishlist.length,
            supportCases: exported.supportCases.length,
            contactMessages: exported.contactMessages.length,
          }
        : {};
    } else {
      const exported = await exportGuestData(tx, customer.email);
      data = exported;
      entity = "guest_customer";
      entityId = customer.orderId;
      filePart = `guest-${customer.orderId.slice(0, 8)}`;
      counts = exported
        ? {
            orders: exported.orders.length,
            supportCases: exported.supportCases.length,
            contactMessages: exported.contactMessages.length,
          }
        : {};
    }
    if (!data) throw new CustomerNotFoundError();

    await writeAudit(tx, {
      actorId: actor.id,
      action: "customer.export",
      entity,
      entityId,
      diff: { by: "staff", actorUserId: actor.id, kind: customer.kind, ...counts },
      ip: actor.ip ?? null,
    });
    return {
      filename: `ifonli-customer-${filePart}-${data.exportedAt.slice(0, 10)}.json`,
      content: JSON.stringify(data, null, 2),
    };
  });
}

export const deleteCustomerInputSchema = z.object({
  /** The customer's e-mail address, typed by the admin to confirm. */
  confirm: z
    .string({ error: "Type the customer's e-mail address to confirm" })
    .trim()
    .min(1, "Type the customer's e-mail address to confirm")
    .max(320),
});

export const GUEST_DELETE_REFUSAL =
  "A guest has no account to delete. Their orders are tax and accounting records that must be kept (D-DPDP-1), so they cannot be erased here. Export their data instead, or handle the request outside the shop.";

/**
 * "Delete account" (DPDP erasure request) for staff. Accounts only, after the admin typed the
 * customer's e-mail address; the erasure itself, its retention rules and its audit row (`customer.delete`)
 * are `deleteCustomerAccount`'s. Staff accounts are refused there as well.
 */
export async function deleteCustomerForStaff(
  db: DbClient,
  rawRef: string,
  raw: unknown,
  actor: AdminActor,
): Promise<{ ordersRetained: number }> {
  assertCan(actor.role, "customer:delete");
  const input = deleteCustomerInputSchema.parse(raw);
  const customer = await resolveCustomer(db, rawRef);
  if (!customer) throw new CustomerNotFoundError();
  if (customer.kind === "guest") throw new AdminInputError(GUEST_DELETE_REFUSAL);
  if (input.confirm.toLowerCase() !== customer.account.email.toLowerCase()) {
    throw new AdminInputError(
      "That is not this customer's e-mail address. Type it exactly to confirm.",
    );
  }
  const result = await deleteCustomerAccount(db, customer.account.id, {
    actor: { id: actor.id, ip: actor.ip ?? null },
  });
  if (!result.ok) throw new AdminInputError(result.message);
  return { ordersRetained: result.ordersRetained };
}
