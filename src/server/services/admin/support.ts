import "server-only";

import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { formatINR } from "@/lib/money";
import { assertCan, can } from "@/server/auth/permissions";
import { adminAuditLog, contactMessages, orders, supportCases, user } from "@/server/db/schema";
import {
  ACTIVE_CASE_STATUSES,
  ACTIVE_CONTACT_STATUSES,
  CONTACT_STATUSES,
  SUPPORT_STATUSES,
  SUPPORT_TYPES,
  canMoveCase,
  canMoveContact,
  isActiveCase,
  normalizeOrderRef,
  type ContactStatus,
  type SupportResolution,
  type SupportStatus,
  type SupportType,
} from "@/server/domain";
import { enqueueCustomerNotification, enqueueNotification } from "@/server/notify/outbox";
import type { PaymentProvider } from "@/server/payments/provider";
import { writeAudit } from "@/server/services/audit";
import { addOrderEvent } from "@/server/services/order-events";
import type { DbClient } from "@/server/services/queries/shared";
import { createSignedReadUrl } from "@/server/storage";

import { getAdminOrderDetail, label, refundOrder, type AdminOrderDetail } from "./orders";
import { AdminInputError, type AdminActor } from "./products";
import {
  ReplacementError,
  createReplacementOrder,
  replacementKey,
  replacementLineSchema,
} from "../replacement-orders";

/* ------------------------------------------------------------------------------------------ */
/* Errors and small helpers                                                                   */
/* ------------------------------------------------------------------------------------------ */

export class SupportNotFoundError extends AdminInputError {
  constructor(what: "message" | "case") {
    super(
      what === "case" ? "That support case no longer exists." : "That message no longer exists.",
    );
    this.name = "SupportNotFoundError";
  }
}

export const SUPPORT_PAGE_SIZE = 25;

/** Short, human id of a case ("0B8C5C1E"): what the team and the audit trail call it. */
export function caseShortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function likePattern(raw: string): string {
  return `%${raw.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

function pageOf(total: number, pageSize: number, requested: number | undefined) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.trunc(requested ?? 1) || 1));
  return { page, pageCount };
}

function clampPageSize(n: number | undefined): number {
  return Math.min(100, Math.max(1, Math.trunc(n ?? SUPPORT_PAGE_SIZE)));
}

function snippet(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function addressName(address: unknown): string {
  const name = (address as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : "";
}

function appendNote(previous: string | null, line: string): string {
  return previous ? `${previous}\n${line}` : line;
}

const messageText = (max: number, what = "message") =>
  z
    .string({ error: `Write a ${what}` })
    .trim()
    .min(1, `Write a ${what}`)
    .max(max, `Keep the ${what} under ${max} characters`);

const assigneeSchema = z.object({ assignedTo: z.string().min(1).max(200).nullable() });
const noteSchema = z.object({ note: messageText(1000, "note") });
const replySchema = z.object({ message: messageText(4000, "reply") });

/* ------------------------------------------------------------------------------------------ */
/* Staff + counts                                                                             */
/* ------------------------------------------------------------------------------------------ */

export interface StaffOption {
  id: string;
  name: string;
  email: string;
  role: string;
}

/** Everyone who can work the support queue (owner, admin, fulfilment), not banned, by name. */
export async function listAssignableStaff(db: DbClient): Promise<StaffOption[]> {
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email, role: user.role })
    .from(user)
    .where(
      and(
        inArray(user.role, ["owner", "admin", "fulfilment"]),
        or(isNull(user.banned), eq(user.banned, false)),
      ),
    )
    .orderBy(asc(user.name), asc(user.id));
  return rows.filter((r) => can(r.role, "support:view"));
}

export interface SupportCounts {
  inbox: { new: number; open: number; active: number; unassigned: number };
  cases: { open: number; inProgress: number; active: number; unassigned: number };
}

/** Open work for the tab badges. "Active" = still needs the team (new/open messages, open/in-progress cases). */
export async function getSupportCounts(db: DbClient): Promise<SupportCounts> {
  const [[msg], [cs]] = await Promise.all([
    db
      .select({
        isNew: sql<number>`count(*) filter (where ${contactMessages.status} = 'new')::int`,
        isOpen: sql<number>`count(*) filter (where ${contactMessages.status} = 'open')::int`,
        unassigned: sql<number>`count(*) filter (where ${contactMessages.status} in ('new', 'open') and ${contactMessages.assignedTo} is null)::int`,
      })
      .from(contactMessages),
    db
      .select({
        isOpen: sql<number>`count(*) filter (where ${supportCases.status} = 'open')::int`,
        inProgress: sql<number>`count(*) filter (where ${supportCases.status} = 'in_progress')::int`,
        unassigned: sql<number>`count(*) filter (where ${supportCases.status} in ('open', 'in_progress') and ${supportCases.assignedTo} is null)::int`,
      })
      .from(supportCases),
  ]);
  const n = (v: number | undefined) => v ?? 0;
  return {
    inbox: {
      new: n(msg?.isNew),
      open: n(msg?.isOpen),
      active: n(msg?.isNew) + n(msg?.isOpen),
      unassigned: n(msg?.unassigned),
    },
    cases: {
      open: n(cs?.isOpen),
      inProgress: n(cs?.inProgress),
      active: n(cs?.isOpen) + n(cs?.inProgress),
      unassigned: n(cs?.unassigned),
    },
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Inbox list                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export interface ContactListFilters {
  /** One status, or "active" for new + open. */
  status?: ContactStatus | "active";
  /** A user id, or "unassigned". */
  assignedTo?: string;
  /** Name, e-mail or order reference. */
  q?: string;
}

export interface ContactListRow {
  id: string;
  name: string;
  email: string;
  orderRef: string | null;
  snippet: string;
  status: ContactStatus;
  assignedTo: string | null;
  assigneeName: string | null;
  createdAt: Date;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function buildContactWhere(f: ContactListFilters): SQL | undefined {
  const conds: (SQL | undefined)[] = [];
  if (f.status === "active")
    conds.push(inArray(contactMessages.status, [...ACTIVE_CONTACT_STATUSES]));
  else if (f.status && (CONTACT_STATUSES as readonly string[]).includes(f.status)) {
    conds.push(eq(contactMessages.status, f.status));
  }
  if (f.assignedTo === "unassigned") conds.push(isNull(contactMessages.assignedTo));
  else if (f.assignedTo) conds.push(eq(contactMessages.assignedTo, f.assignedTo));
  const q = f.q?.trim().slice(0, 100);
  if (q) {
    const pattern = likePattern(q);
    conds.push(
      or(
        ilike(contactMessages.name, pattern),
        ilike(contactMessages.email, pattern),
        ilike(contactMessages.orderRef, pattern),
      ),
    );
  }
  return conds.length ? and(...conds) : undefined;
}

/** Contact messages, newest first. */
export async function listContactMessages(
  db: DbClient,
  params: ContactListFilters & { page?: number; pageSize?: number } = {},
): Promise<Paged<ContactListRow>> {
  const pageSize = clampPageSize(params.pageSize);
  const where = buildContactWhere(params);
  const [totalRow] = await db.select({ n: count() }).from(contactMessages).where(where);
  const total = totalRow?.n ?? 0;
  const { page, pageCount } = pageOf(total, pageSize, params.page);
  const rows = await db
    .select({ m: contactMessages, assigneeName: user.name })
    .from(contactMessages)
    .leftJoin(user, eq(contactMessages.assignedTo, user.id))
    .where(where)
    .orderBy(desc(contactMessages.createdAt), desc(contactMessages.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return {
    items: rows.map(({ m, assigneeName }) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      orderRef: m.orderRef,
      snippet: snippet(m.message),
      status: m.status,
      assignedTo: m.assignedTo,
      assigneeName,
      createdAt: m.createdAt,
    })),
    total,
    page,
    pageSize,
    pageCount,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Cases list                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export interface CaseListFilters {
  /** One status, or "active" for open + in progress. */
  status?: SupportStatus | "active";
  type?: SupportType;
  /** A user id, or "unassigned". */
  assignedTo?: string;
  /** Customer name, e-mail, order reference or case id. */
  q?: string;
}

export interface CaseListRow {
  id: string;
  shortId: string;
  orderId: string;
  orderRef: string;
  customerName: string;
  email: string;
  type: SupportType;
  status: SupportStatus;
  resolution: SupportResolution | null;
  snippet: string;
  photoCount: number;
  assignedTo: string | null;
  assigneeName: string | null;
  createdAt: Date;
}

export function buildCaseWhere(f: CaseListFilters): SQL | undefined {
  const conds: (SQL | undefined)[] = [];
  if (f.status === "active") conds.push(inArray(supportCases.status, [...ACTIVE_CASE_STATUSES]));
  else if (f.status && (SUPPORT_STATUSES as readonly string[]).includes(f.status)) {
    conds.push(eq(supportCases.status, f.status));
  }
  if (f.type && (SUPPORT_TYPES as readonly string[]).includes(f.type))
    conds.push(eq(supportCases.type, f.type));
  if (f.assignedTo === "unassigned") conds.push(isNull(supportCases.assignedTo));
  else if (f.assignedTo) conds.push(eq(supportCases.assignedTo, f.assignedTo));
  const q = f.q?.trim().slice(0, 100);
  if (q) {
    const pattern = likePattern(q);
    conds.push(
      or(
        ilike(orders.ref, pattern),
        ilike(orders.email, pattern),
        sql`${orders.shippingAddress}->>'name' ilike ${pattern}`,
        sql`${supportCases.id}::text ilike ${pattern}`,
      ),
    );
  }
  return conds.length ? and(...conds) : undefined;
}

/** Support cases, newest first. */
export async function listSupportCases(
  db: DbClient,
  params: CaseListFilters & { page?: number; pageSize?: number } = {},
): Promise<Paged<CaseListRow>> {
  const pageSize = clampPageSize(params.pageSize);
  const where = buildCaseWhere(params);
  const [totalRow] = await db
    .select({ n: count() })
    .from(supportCases)
    .innerJoin(orders, eq(orders.id, supportCases.orderId))
    .where(where);
  const total = totalRow?.n ?? 0;
  const { page, pageCount } = pageOf(total, pageSize, params.page);
  const assignee = alias(user, "assignee");
  const rows = await db
    .select({ c: supportCases, order: orders, assigneeName: assignee.name })
    .from(supportCases)
    .innerJoin(orders, eq(orders.id, supportCases.orderId))
    .leftJoin(assignee, eq(supportCases.assignedTo, assignee.id))
    .where(where)
    .orderBy(desc(supportCases.createdAt), desc(supportCases.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return {
    items: rows.map(({ c, order, assigneeName }) => ({
      id: c.id,
      shortId: caseShortId(c.id),
      orderId: order.id,
      orderRef: order.ref,
      customerName: addressName(order.shippingAddress),
      email: order.email,
      type: c.type,
      status: c.status,
      resolution: c.resolution,
      snippet: snippet(c.description),
      photoCount: c.photoPaths.length,
      assignedTo: c.assignedTo,
      assigneeName,
      createdAt: c.createdAt,
    })),
    total,
    page,
    pageSize,
    pageCount,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Timeline (the audit trail of one message or case)                                          */
/* ------------------------------------------------------------------------------------------ */

export interface SupportTimelineEntry {
  id: string;
  action: string;
  actorName: string | null;
  createdAt: Date;
  /** Free-form summary stored with the audit row (`note`, `message`, `from`, `to`, ...). */
  detail: Record<string, unknown>;
}

async function loadTimeline(db: DbClient, entity: "support_case" | "contact_message", id: string) {
  const rows = await db
    .select({ a: adminAuditLog, actorName: user.name })
    .from(adminAuditLog)
    .leftJoin(user, eq(adminAuditLog.actorId, user.id))
    .where(and(eq(adminAuditLog.entity, entity), eq(adminAuditLog.entityId, id)))
    .orderBy(asc(adminAuditLog.createdAt), asc(adminAuditLog.id));
  return rows.map<SupportTimelineEntry>(({ a, actorName }) => ({
    id: a.id,
    action: a.action,
    actorName,
    createdAt: a.createdAt,
    detail:
      a.diff && typeof a.diff === "object" && !Array.isArray(a.diff)
        ? (a.diff as Record<string, unknown>)
        : {},
  }));
}

/* ------------------------------------------------------------------------------------------ */
/* Contact message detail                                                                     */
/* ------------------------------------------------------------------------------------------ */

export interface ContactMessageDetail {
  message: typeof contactMessages.$inferSelect;
  assigneeName: string | null;
  /** The order the customer named, if the reference matches one. */
  order: {
    id: string;
    ref: string;
    status: string;
    paymentStatus: string;
    fulfillmentStatus: string;
    totalPaise: number;
    placedAt: Date;
    /** The message was sent from the order's e-mail address (a typed reference alone proves nothing). */
    emailMatches: boolean;
  } | null;
  /** Other messages from the same e-mail address. */
  otherMessages: number;
  timeline: SupportTimelineEntry[];
  allowedStatuses: ContactStatus[];
}

export async function getContactMessageDetail(
  db: DbClient,
  id: string,
): Promise<ContactMessageDetail | null> {
  const [row] = await db
    .select({ m: contactMessages, assigneeName: user.name })
    .from(contactMessages)
    .leftJoin(user, eq(contactMessages.assignedTo, user.id))
    .where(eq(contactMessages.id, id))
    .limit(1);
  if (!row) return null;
  const m = row.m;
  const ref = m.orderRef ? normalizeOrderRef(m.orderRef) : null;
  const [orderRow, [others], timeline] = await Promise.all([
    ref ? db.select().from(orders).where(eq(orders.ref, ref)).limit(1) : Promise.resolve([]),
    db
      .select({ n: count() })
      .from(contactMessages)
      .where(
        and(
          sql`lower(${contactMessages.email}) = lower(${m.email})`,
          sql`${contactMessages.id} <> ${m.id}`,
        ),
      ),
    loadTimeline(db, "contact_message", id),
  ]);
  const o = orderRow[0];
  return {
    message: m,
    assigneeName: row.assigneeName,
    order: o
      ? {
          id: o.id,
          ref: o.ref,
          status: o.status,
          paymentStatus: o.paymentStatus,
          fulfillmentStatus: o.fulfillmentStatus,
          totalPaise: o.totalPaise,
          placedAt: o.placedAt,
          emailMatches: o.email.toLowerCase() === m.email.toLowerCase(),
        }
      : null,
    otherMessages: others?.n ?? 0,
    timeline,
    allowedStatuses: CONTACT_STATUSES.filter((s) => canMoveContact(m.status, s)),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Contact message mutations                                                                  */
/* ------------------------------------------------------------------------------------------ */

async function lockMessage(tx: DbClient, id: string) {
  const [row] = await tx
    .select()
    .from(contactMessages)
    .where(eq(contactMessages.id, id))
    .for("update");
  if (!row) throw new SupportNotFoundError("message");
  return row;
}

async function lockCase(tx: DbClient, id: string) {
  const [row] = await tx.select().from(supportCases).where(eq(supportCases.id, id)).for("update");
  if (!row) throw new SupportNotFoundError("case");
  return row;
}

/** Resolves the assignee (or null to unassign). Only people who can see support can be assigned. */
async function resolveAssignee(tx: DbClient, assignedTo: string | null) {
  if (assignedTo === null) return null;
  const [u] = await tx
    .select({ id: user.id, name: user.name, role: user.role, banned: user.banned })
    .from(user)
    .where(eq(user.id, assignedTo))
    .limit(1);
  if (!u || u.banned || !can(u.role, "support:view")) {
    throw new AdminInputError("That person can't be assigned. Pick someone from the team list.");
  }
  return { id: u.id, name: u.name };
}

async function nameOf(tx: DbClient, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [u] = await tx.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return u?.name ?? null;
}

export interface MessageMutationResult {
  messageId: string;
}

export async function assignContactMessage(
  db: DbClient,
  messageId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<MessageMutationResult> {
  assertCan(actor.role, "support:respond");
  const input = assigneeSchema.parse(raw);
  return db.transaction(async (tx) => {
    const m = await lockMessage(tx, messageId);
    const to = await resolveAssignee(tx, input.assignedTo);
    if ((m.assignedTo ?? null) === (to?.id ?? null)) {
      throw new AdminInputError(
        to ? `Already assigned to ${to.name}.` : "This message is not assigned to anyone.",
      );
    }
    const fromName = await nameOf(tx, m.assignedTo);
    await tx
      .update(contactMessages)
      .set({ assignedTo: to?.id ?? null })
      .where(eq(contactMessages.id, messageId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "contact_message.assign",
      entity: "contact_message",
      entityId: messageId,
      diff: { from: fromName, to: to?.name ?? null, assignedTo: to?.id ?? null },
      ip: actor.ip,
    });
    return { messageId };
  });
}

export const contactStatusSchema = z.object({ status: z.enum(CONTACT_STATUSES) });

export async function setContactMessageStatus(
  db: DbClient,
  messageId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<MessageMutationResult> {
  assertCan(actor.role, "support:respond");
  const input = contactStatusSchema.parse(raw);
  return db.transaction(async (tx) => {
    const m = await lockMessage(tx, messageId);
    if (!canMoveContact(m.status, input.status)) {
      throw new AdminInputError(
        input.status === m.status
          ? `This message is already ${label(m.status)}.`
          : `A ${label(m.status)} message can't move to "${label(input.status)}".`,
      );
    }
    await tx
      .update(contactMessages)
      .set({ status: input.status })
      .where(eq(contactMessages.id, messageId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "contact_message.status",
      entity: "contact_message",
      entityId: messageId,
      diff: { from: m.status, to: input.status },
      ip: actor.ip,
    });
    return { messageId };
  });
}

export async function addContactMessageNote(
  db: DbClient,
  messageId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<MessageMutationResult> {
  assertCan(actor.role, "support:respond");
  const input = noteSchema.parse(raw);
  return db.transaction(async (tx) => {
    await lockMessage(tx, messageId);
    await writeAudit(tx, {
      actorId: actor.id,
      action: "contact_message.note",
      entity: "contact_message",
      entityId: messageId,
      diff: { note: input.note },
      ip: actor.ip,
    });
    return { messageId };
  });
}

/**
 * Replies to a contact message by e-mail (`contact_reply` through the outbox, in the same transaction).
 * A closed message must be re-opened first. Replying moves `new` to `open` and, when nobody owns the
 * message yet, assigns it to the person who replied.
 */
export async function replyToContactMessage(
  db: DbClient,
  messageId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<MessageMutationResult & { to: string }> {
  assertCan(actor.role, "support:respond");
  const input = replySchema.parse(raw);
  return db.transaction(async (tx) => {
    const m = await lockMessage(tx, messageId);
    if (m.status === "closed")
      throw new AdminInputError("This message is closed. Re-open it to reply.");
    const set: Partial<typeof contactMessages.$inferInsert> = {};
    if (m.status === "new") set.status = "open";
    if (!m.assignedTo) set.assignedTo = actor.id;
    if (Object.keys(set).length > 0) {
      await tx.update(contactMessages).set(set).where(eq(contactMessages.id, messageId));
    }
    // An explicit reply always goes out: it is not one of the owner-switchable automatic e-mails.
    await enqueueNotification(tx, {
      template: "contact_reply",
      to: m.email,
      payload: {
        name: m.name,
        message: input.message,
        original: m.message.slice(0, 4000),
        messageId: m.id,
      },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "contact_message.reply",
      entity: "contact_message",
      entityId: messageId,
      diff: {
        message: input.message,
        to: m.email,
        statusFrom: m.status,
        statusTo: set.status ?? m.status,
        claimed: set.assignedTo ? true : undefined,
      },
      ip: actor.ip,
    });
    return { messageId, to: m.email };
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Case detail                                                                                */
/* ------------------------------------------------------------------------------------------ */

export interface CasePhoto {
  path: string;
  name: string;
  /** Short-lived signed URL, or null when storage is not configured / signing failed. */
  url: string | null;
  isImage: boolean;
}

export const CASE_PHOTO_URL_TTL_SECONDS = 600;
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif)$/i;

/**
 * Signed read URLs (10 minutes) for the private-bucket photos of a case. Never throws: with storage
 * unconfigured, or a path that cannot be signed, the photo comes back with `url: null` so the page can
 * say "preview unavailable" and still list the file name.
 */
export async function signCasePhotos(paths: readonly string[]): Promise<CasePhoto[]> {
  return Promise.all(
    paths.map(async (path) => {
      const name = path.split("/").pop() || path;
      let url: string | null = null;
      try {
        url = await createSignedReadUrl("private", path, CASE_PHOTO_URL_TTL_SECONDS);
      } catch {
        url = null;
      }
      return { path, name, url, isImage: IMAGE_EXT.test(path) };
    }),
  );
}

export interface SupportCaseDetail {
  case: typeof supportCases.$inferSelect;
  shortId: string;
  assigneeName: string | null;
  order: AdminOrderDetail;
  /** The no-charge order created by a "replacement" resolution, if any. */
  replacementOrder: { id: string; ref: string; status: string; fulfillmentStatus: string } | null;
  timeline: SupportTimelineEntry[];
  /** Other cases on the same order. */
  siblingCases: { id: string; shortId: string; type: SupportType; status: SupportStatus }[];
  allowedStatuses: SupportStatus[];
  /** Whether Resolve / Reject make sense (an active case). */
  canDecide: boolean;
}

export async function getSupportCaseDetail(
  db: DbClient,
  id: string,
): Promise<SupportCaseDetail | null> {
  const [row] = await db
    .select({ c: supportCases, assigneeName: user.name })
    .from(supportCases)
    .leftJoin(user, eq(supportCases.assignedTo, user.id))
    .where(eq(supportCases.id, id))
    .limit(1);
  if (!row) return null;
  const c = row.c;
  const [order, replacement, siblings, timeline] = await Promise.all([
    getAdminOrderDetail(db, c.orderId),
    db
      .select({
        id: orders.id,
        ref: orders.ref,
        status: orders.status,
        fulfillmentStatus: orders.fulfillmentStatus,
      })
      .from(orders)
      .where(eq(orders.idempotencyKey, replacementKey(c.id)))
      .limit(1),
    db
      .select({ id: supportCases.id, type: supportCases.type, status: supportCases.status })
      .from(supportCases)
      .where(and(eq(supportCases.orderId, c.orderId), sql`${supportCases.id} <> ${c.id}`))
      .orderBy(desc(supportCases.createdAt)),
    loadTimeline(db, "support_case", id),
  ]);
  if (!order) return null;
  return {
    case: c,
    shortId: caseShortId(c.id),
    assigneeName: row.assigneeName,
    order,
    replacementOrder: replacement[0] ?? null,
    timeline,
    siblingCases: siblings.map((s) => ({ ...s, shortId: caseShortId(s.id) })),
    allowedStatuses: SUPPORT_STATUSES.filter((s) => canMoveCase(c.status, s)),
    canDecide: isActiveCase(c.status),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Case mutations                                                                             */
/* ------------------------------------------------------------------------------------------ */

export interface CaseMutationResult {
  caseId: string;
}

export async function assignSupportCase(
  db: DbClient,
  caseId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<CaseMutationResult> {
  assertCan(actor.role, "support:respond");
  const input = assigneeSchema.parse(raw);
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, caseId);
    const to = await resolveAssignee(tx, input.assignedTo);
    if ((c.assignedTo ?? null) === (to?.id ?? null)) {
      throw new AdminInputError(
        to ? `Already assigned to ${to.name}.` : "This case is not assigned to anyone.",
      );
    }
    const fromName = await nameOf(tx, c.assignedTo);
    await tx
      .update(supportCases)
      .set({ assignedTo: to?.id ?? null })
      .where(eq(supportCases.id, caseId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "support_case.assign",
      entity: "support_case",
      entityId: caseId,
      diff: { from: fromName, to: to?.name ?? null, assignedTo: to?.id ?? null },
      ip: actor.ip,
    });
    return { caseId };
  });
}

export const caseStatusSchema = z.object({ status: z.enum(SUPPORT_STATUSES) });

/**
 * Moves a case to a new status. Only `open -> in_progress` is available here: the two outcomes
 * (resolved, rejected) carry a resolution, a note and a customer e-mail, so they only happen through
 * `resolveSupportCase` / `rejectSupportCase`.
 */
export async function setSupportCaseStatus(
  db: DbClient,
  caseId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<CaseMutationResult> {
  assertCan(actor.role, "support:respond");
  const input = caseStatusSchema.parse(raw);
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, caseId);
    if (input.status === "resolved" || input.status === "rejected") {
      throw new AdminInputError(
        "Use Resolve or Reject to close a case: they record the outcome and tell the customer.",
      );
    }
    if (!canMoveCase(c.status, input.status)) {
      throw new AdminInputError(
        input.status === c.status
          ? `This case is already ${label(c.status)}.`
          : `A ${label(c.status)} case can't move to "${label(input.status)}".`,
      );
    }
    await tx.update(supportCases).set({ status: input.status }).where(eq(supportCases.id, caseId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "support_case.status",
      entity: "support_case",
      entityId: caseId,
      diff: { from: c.status, to: input.status },
      ip: actor.ip,
    });
    return { caseId };
  });
}

export async function addSupportCaseNote(
  db: DbClient,
  caseId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<CaseMutationResult> {
  assertCan(actor.role, "support:respond");
  const input = noteSchema.parse(raw);
  return db.transaction(async (tx) => {
    await lockCase(tx, caseId);
    await writeAudit(tx, {
      actorId: actor.id,
      action: "support_case.note",
      entity: "support_case",
      entityId: caseId,
      diff: { note: input.note },
      ip: actor.ip,
    });
    return { caseId };
  });
}

async function orderForCase(tx: DbClient, orderId: string) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!o) throw new AdminInputError("The order for this case no longer exists.");
  return o;
}

/**
 * Sends the customer a message about the case (`support_case_update` with the team's note, through the
 * outbox). Allowed in any status (e.g. to share a tracking number after a replacement). Responding to an
 * `open` case moves it to `in_progress`, and an unassigned case is claimed by the responder.
 */
export async function respondToSupportCase(
  db: DbClient,
  caseId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<CaseMutationResult & { to: string }> {
  assertCan(actor.role, "support:respond");
  const input = replySchema.parse(raw);
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, caseId);
    const order = await orderForCase(tx, c.orderId);
    const set: Partial<typeof supportCases.$inferInsert> = {};
    if (c.status === "open") set.status = "in_progress";
    if (!c.assignedTo && isActiveCase(c.status)) set.assignedTo = actor.id;
    if (Object.keys(set).length > 0)
      await tx.update(supportCases).set(set).where(eq(supportCases.id, caseId));
    await enqueueNotification(tx, {
      orderId: order.id,
      template: "support_case_update",
      to: order.email,
      payload: {
        ref: order.ref,
        caseId: c.id,
        status: set.status ?? c.status,
        resolution: c.resolution,
        note: input.message,
      },
    });
    await addOrderEvent(tx, order.id, {
      type: "support_case_response",
      note: `Support case ${caseShortId(c.id)}: replied to the customer.`,
      actorId: actor.id,
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "support_case.respond",
      entity: "support_case",
      entityId: caseId,
      diff: {
        message: input.message,
        to: order.email,
        statusFrom: c.status,
        statusTo: set.status ?? c.status,
      },
      ip: actor.ip,
    });
    return { caseId, to: order.email };
  });
}

/* --------------------------------- resolve: refund / replacement ---------------------------- */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const resolveInputSchema = z.discriminatedUnion("resolution", [
  z.object({
    resolution: z.literal("refund"),
    /** Full or partial, in paise (at most what is still refundable on the order). */
    amountPaise: z.number().int("Whole paise only").positive("Enter an amount above 0"),
    /** UPI / bank reference. Required for COD (manual) refunds. */
    reference: optionalText(120),
    /** Shown to the customer in the e-mail. A standard message is used when blank. */
    message: optionalText(1000),
    /** Internal. Kept in the case notes. */
    note: optionalText(1000),
  }),
  z.object({
    resolution: z.literal("replacement"),
    lines: z.array(replacementLineSchema).min(1, "Pick at least one item to replace").max(50),
    message: optionalText(1000),
    note: optionalText(1000),
  }),
]);
export type ResolveInput = z.infer<typeof resolveInputSchema>;

export const rejectInputSchema = z.object({
  /** Shown to the customer: be kind, say why. */
  message: messageText(1000, "message for the customer"),
  /** Internal. Kept in the case notes. */
  note: optionalText(1000),
});

export interface ResolveCaseResult extends CaseMutationResult {
  /** Products whose stock changed (for `revalidateStock`). */
  productIds: string[];
  refund: {
    refundId: string;
    status: string;
    amountPaise: number;
    providerError: string | null;
  } | null;
  replacement: { orderId: string; ref: string; units: number } | null;
}

function assertActive(c: { status: SupportStatus }, what = "resolved"): void {
  if (!isActiveCase(c.status)) {
    throw new AdminInputError(
      `This case is already ${label(c.status)}; it can't be ${what} again.`,
    );
  }
}

/** Marks the case decided: status, resolution, notes, order timeline, customer e-mail and audit, in `tx`. */
async function closeCase(
  tx: DbClient,
  c: typeof supportCases.$inferSelect,
  order: typeof orders.$inferSelect,
  outcome: {
    status: "resolved" | "rejected";
    resolution: SupportResolution;
    noteLine: string;
    customerNote: string;
    internalNote: string | null;
    audit: Record<string, unknown>;
  },
  actor: AdminActor,
): Promise<void> {
  let notes = appendNote(c.notes, outcome.noteLine);
  if (outcome.internalNote) notes = appendNote(notes, `Note: ${outcome.internalNote}`);
  await tx
    .update(supportCases)
    .set({
      status: outcome.status,
      resolution: outcome.resolution,
      notes,
      assignedTo: c.assignedTo ?? actor.id,
    })
    .where(eq(supportCases.id, c.id));
  await addOrderEvent(tx, order.id, {
    type: outcome.status === "resolved" ? "support_case_resolved" : "support_case_rejected",
    from: c.status,
    to: outcome.status,
    note: `Support case ${caseShortId(c.id)}: ${outcome.noteLine}`,
    actorId: actor.id,
  });
  await enqueueCustomerNotification(tx, {
    orderId: order.id,
    template: "support_case_update",
    to: order.email,
    payload: {
      ref: order.ref,
      caseId: c.id,
      status: outcome.status,
      resolution: outcome.resolution,
      note: outcome.customerNote,
    },
  });
  await writeAudit(tx, {
    actorId: actor.id,
    action: outcome.status === "resolved" ? "support_case.resolve" : "support_case.reject",
    entity: "support_case",
    entityId: c.id,
    diff: {
      from: c.status,
      to: outcome.status,
      resolution: outcome.resolution,
      ref: order.ref,
      ...outcome.audit,
    },
    ip: actor.ip,
  });
}

/**
 * Resolves a case with a refund or a replacement.
 *
 *  - refund: runs the existing `refundOrder` (full or partial, needs `order:refund` as well as
 *    `support:resolve`), then closes the case in a second transaction and links the refund id in the
 *    case notes. The refund calls the payment provider outside any transaction (as everywhere else), so a
 *    failure BEFORE the refund leaves the case untouched; if the case was closed by someone else while the
 *    refund ran, the refund stands (it is on the order) and the error says so.
 *  - replacement: one transaction creates the no-charge order (stock out through the ledger), closes the
 *    case and queues the e-mail; any failure (stock, validation) rolls everything back.
 */
export async function resolveSupportCase(
  db: DbClient,
  caseId: string,
  raw: unknown,
  actor: AdminActor,
  provider?: PaymentProvider,
): Promise<ResolveCaseResult> {
  assertCan(actor.role, "support:resolve");
  const input = resolveInputSchema.parse(raw);
  if (input.resolution === "refund") assertCan(actor.role, "order:refund");

  if (input.resolution === "refund") {
    const [c] = await db.select().from(supportCases).where(eq(supportCases.id, caseId)).limit(1);
    if (!c) throw new SupportNotFoundError("case");
    assertActive(c);
    const refund = await refundOrder(
      db,
      c.orderId,
      {
        amountPaise: input.amountPaise,
        reason: `Support case ${caseShortId(c.id)} (${label(c.type)})`,
        reference: input.reference,
      },
      actor,
      provider,
    );
    await db.transaction(async (tx) => {
      const fresh = await lockCase(tx, caseId);
      if (!isActiveCase(fresh.status)) {
        throw new AdminInputError(
          `The refund of ${formatINR(input.amountPaise)} was recorded on the order, but this case was ${label(fresh.status)} by someone else in the meantime. Check the order's refunds.`,
        );
      }
      const order = await orderForCase(tx, fresh.orderId);
      const isCod = order.paymentMethod === "cod";
      const customerNote =
        input.message ??
        (isCod
          ? `We have refunded ${formatINR(input.amountPaise)} to you${input.reference ? ` (reference ${input.reference})` : ""}. Sorry for the trouble.`
          : `We have started a refund of ${formatINR(input.amountPaise)} to your original payment method. It can take a few days to reach you. Sorry for the trouble.`);
      await closeCase(
        tx,
        fresh,
        order,
        {
          status: "resolved",
          resolution: "refund",
          noteLine: `Refunded ${formatINR(input.amountPaise)} (refund ${refund.refundId.slice(0, 8)}, ${refund.status}).`,
          customerNote,
          internalNote: input.note,
          audit: {
            refundId: refund.refundId,
            refundStatus: refund.status,
            amountPaise: input.amountPaise,
            providerError: refund.providerError,
          },
        },
        actor,
      );
    });
    return {
      caseId,
      productIds: refund.productIds,
      refund: {
        refundId: refund.refundId,
        status: refund.status,
        amountPaise: input.amountPaise,
        providerError: refund.providerError,
      },
      replacement: null,
    };
  }

  return db.transaction(async (tx) => {
    const c = await lockCase(tx, caseId);
    assertActive(c);
    const order = await orderForCase(tx, c.orderId);
    if (!["confirmed", "processing", "completed"].includes(order.status)) {
      throw new AdminInputError(`A ${label(order.status)} order can't be replaced.`);
    }
    let created;
    try {
      created = await createReplacementOrder(tx, {
        original: order,
        caseId: c.id,
        lines: input.lines,
        actorId: actor.id,
      });
    } catch (e) {
      if (e instanceof ReplacementError) throw new AdminInputError(e.message);
      throw e;
    }
    await closeCase(
      tx,
      c,
      order,
      {
        status: "resolved",
        resolution: "replacement",
        noteLine: `Replacement order ${created.ref} created (${created.units} unit(s), no charge).`,
        customerNote:
          input.message ??
          `We are sending you a replacement at no charge. Your new order reference is ${created.ref}. Sorry for the trouble.`,
        internalNote: input.note,
        audit: {
          replacementOrderId: created.orderId,
          replacementRef: created.ref,
          units: created.units,
        },
      },
      actor,
    );
    return {
      caseId,
      productIds: created.productIds,
      refund: null,
      replacement: { orderId: created.orderId, ref: created.ref, units: created.units },
    };
  });
}

/** Rejects a case with a note the customer receives (kindly worded by the team). */
export async function rejectSupportCase(
  db: DbClient,
  caseId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<CaseMutationResult> {
  assertCan(actor.role, "support:resolve");
  const input = rejectInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, caseId);
    assertActive(c, "rejected");
    const order = await orderForCase(tx, c.orderId);
    await closeCase(
      tx,
      c,
      order,
      {
        status: "rejected",
        resolution: "rejected",
        noteLine: `Rejected: ${input.message}`,
        customerNote: input.message,
        internalNote: input.note,
        audit: {},
      },
      actor,
    );
    return { caseId };
  });
}
