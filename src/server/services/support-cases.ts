import "server-only";

import { createHash } from "node:crypto";

import { and, desc, eq, inArray, max, sql } from "drizzle-orm";

import {
  SUPPORT_PHOTO_MAX_BYTES,
  SUPPORT_PHOTO_TYPES,
  reportableTypes,
  supportCaseSchema,
  validatePhotoFiles,
  type SupportField,
  type SupportPhotoFile,
  type SupportPhotoType,
  type SupportType,
} from "@/features/orders/support-schema";
import { orderEvents, shipments, supportCases } from "@/server/db/schema";
import { normalizeOrderRef } from "@/server/domain";
import { enqueueAdminAlert, enqueueCustomerNotification } from "@/server/notify/outbox";
import {
  StorageError,
  createSignedReadUrl,
  createSignedUploadUrl,
} from "@/server/storage";

import { writeAudit } from "./audit";
import { findOrderForAccess, type OrderAccess } from "./customer-orders";
import { addOrderEvent } from "./order-events";
import { readSettings, type DbClient } from "./queries/shared";
import { consumeRateLimit } from "./rate-limit";

/**
 * "Report a problem" (plan 7.8, C-17): a customer-side support case on an order, with up to four
 * photos in the private bucket. Customer creation only; the admin Support module reads and resolves
 * the same `support_cases` rows.
 *
 * Statutory rights: defective, wrong and missing items are never refused because of timing. The owner's
 * `damaged_claim_window_hours` is a flag for the team ("reported after the usual window"), not a gate;
 * the customer is told kindly and the case is still created.
 */

export * from "@/features/orders/support-schema";

const MAX_OPEN_CASES_PER_ORDER = 3;

export const SUPPORT_LIMITS = {
  ip: { limit: 10, windowSeconds: 3600 },
  order: { limit: 6, windowSeconds: 86_400 },
  upload: { limit: 20, windowSeconds: 3600 },
} as const;

/* ------------------------------------------------------------------------------------------ */
/* Photo storage                                                                              */
/* ------------------------------------------------------------------------------------------ */

export interface SupportPhotoStorage {
  /** False when Supabase Storage is not configured (local dev without it): the form hides photos. */
  configured(): boolean;
  /** A signed URL the browser PUTs the file to. */
  createUpload(path: string): Promise<{ url: string }>;
  /** Looks at what was really stored (size and type), so a client cannot claim a different file. */
  inspect(path: string): Promise<{ bytes: number; contentType: string } | null>;
}

const BUCKET = "private";

export const supabaseSupportPhotoStorage: SupportPhotoStorage = {
  configured: () =>
    Boolean((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY),
  async createUpload(path) {
    const upload = await createSignedUploadUrl(BUCKET, path);
    return { url: upload.url };
  },
  async inspect(path) {
    try {
      const url = await createSignedReadUrl(BUCKET, path, 60);
      const res = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (!res.ok) return null;
      return {
        bytes: Number(res.headers.get("content-length") ?? "0"),
        contentType: (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase(),
      };
    } catch (e) {
      if (e instanceof StorageError) return null;
      throw e;
    }
  },
};

/** `support/{orderId}/{uuid}.{ext}`: the only shape a stored photo path may have for that order. */
export function supportPhotoPathPattern(orderId: string): RegExp {
  return new RegExp(`^support/${orderId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png|webp)$`);
}

/* ------------------------------------------------------------------------------------------ */
/* Window                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/** When the order was delivered: the shipment's stamp, else the timeline event, else null. */
export async function deliveredAtOf(db: DbClient, orderId: string): Promise<Date | null> {
  const [ship] = await db
    .select({ at: max(shipments.deliveredAt) })
    .from(shipments)
    .where(eq(shipments.orderId, orderId));
  if (ship?.at) return ship.at;
  const [event] = await db
    .select({ at: orderEvents.createdAt })
    .from(orderEvents)
    .where(
      and(
        eq(orderEvents.orderId, orderId),
        eq(orderEvents.type, "fulfillment_changed"),
        eq(orderEvents.toValue, "delivered"),
      ),
    )
    .orderBy(desc(orderEvents.createdAt))
    .limit(1);
  return event?.at ?? null;
}

export interface ClaimWindow {
  /** The owner's window in hours; 0 (or unset placeholder) means no window. */
  hours: number;
  deliveredAt: Date | null;
  /** Hours since delivery, when delivered. */
  hoursSinceDelivery: number | null;
  /** True when the window is set, the order was delivered and the window has ended. */
  late: boolean;
}

/** Pure: is a report made at `now` outside the owner's claim window? */
export function claimWindow(hours: number, deliveredAt: Date | null, now: Date): ClaimWindow {
  const since = deliveredAt ? (now.getTime() - deliveredAt.getTime()) / 3_600_000 : null;
  return {
    hours,
    deliveredAt,
    hoursSinceDelivery: since,
    late: hours > 0 && since !== null && since > hours,
  };
}

export async function loadClaimWindow(db: DbClient, orderId: string, now: Date): Promise<ClaimWindow> {
  const [settings, deliveredAt] = await Promise.all([
    readSettings(db, ["damaged_claim_window_hours"]),
    deliveredAtOf(db, orderId),
  ]);
  const setting = settings.damaged_claim_window_hours;
  // A placeholder window was never set by the owner: do not flag anything against it.
  const hours = setting.isPlaceholder ? 0 : setting.value;
  return claimWindow(hours, deliveredAt, now);
}

/* ------------------------------------------------------------------------------------------ */
/* Photo upload targets                                                                       */
/* ------------------------------------------------------------------------------------------ */

export type PrepareUploadsResult =
  | { ok: true; uploads: { path: string; url: string }[] }
  | { ok: false; code: "not_found" | "invalid" | "rate_limited" | "storage_unavailable"; message: string };

const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

/**
 * Step 1 of attaching photos: signed upload URLs for the files the customer picked, after checking
 * they own the order and the files look right (count, type, size). Nothing is recorded yet; the
 * photos only count once `createSupportCase` receives their paths.
 */
export async function prepareSupportPhotoUploads(
  db: DbClient,
  input: { ref: string; access: OrderAccess; files: SupportPhotoFile[]; ip: string },
  deps: { storage?: SupportPhotoStorage } = {},
): Promise<PrepareUploadsResult> {
  const storage = deps.storage ?? supabaseSupportPhotoStorage;
  if (!storage.configured()) {
    return { ok: false, code: "storage_unavailable", message: "Photo upload isn't available right now. You can still send your report without photos." };
  }
  if (input.files.length === 0) return { ok: true, uploads: [] };
  const problem = validatePhotoFiles(input.files);
  if (problem) return { ok: false, code: "invalid", message: problem };

  const limit = await consumeRateLimit(db, `support-upload:ip:${input.ip}`, SUPPORT_LIMITS.upload);
  if (!limit.allowed) {
    return { ok: false, code: "rate_limited", message: "Too many uploads. Please wait a while and try again." };
  }
  const order = await findOrderForAccess(db, input.ref, input.access);
  if (!order) return { ok: false, code: "not_found", message: "We couldn't find that order." };

  try {
    const uploads = await Promise.all(
      input.files.map(async (file) => {
        const ext = SUPPORT_PHOTO_TYPES[file.type as SupportPhotoType];
        const path = `support/${order.id}/${crypto.randomUUID()}.${ext}`;
        return { path, url: (await storage.createUpload(path)).url };
      }),
    );
    return { ok: true, uploads };
  } catch (e) {
    console.error("support photo upload url failed", e instanceof Error ? e.message : "unknown");
    return { ok: false, code: "storage_unavailable", message: "Photo upload isn't available right now. You can still send your report without photos." };
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Create                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export type CreateSupportCaseResult =
  | {
      ok: true;
      caseId: string;
      /** Reported after the owner's claim window: still accepted, flagged for the team. */
      late: boolean;
    }
  | {
      ok: false;
      code: "invalid" | "not_found" | "not_reportable" | "too_many_open" | "rate_limited";
      message: string;
      fieldErrors?: Partial<Record<SupportField, string>>;
      retryAfterSeconds?: number;
    };

/**
 * Creates the support case for an order the caller owns: validates, checks the photos really are in
 * storage, writes the case, a customer-visible timeline entry, the team alert (`new_support_case`)
 * and the customer's acknowledgement (`support_case_update`, status `open`) in one transaction.
 * Rate limited by IP and by order.
 */
export async function createSupportCase(
  db: DbClient,
  input: { ref: string; access: OrderAccess; raw: unknown; ip: string; now?: Date },
  deps: { storage?: SupportPhotoStorage } = {},
): Promise<CreateSupportCaseResult> {
  const storage = deps.storage ?? supabaseSupportPhotoStorage;
  const now = input.now ?? new Date();

  const parsed = supportCaseSchema.safeParse(input.raw);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<SupportField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "type" || field === "description" || field === "photoPaths") fieldErrors[field] ??= issue.message;
    }
    return { ok: false, code: "invalid", message: "Check the highlighted fields.", fieldErrors };
  }
  const data = parsed.data;

  const decisions = await Promise.all([
    consumeRateLimit(db, `support:ip:${input.ip}`, SUPPORT_LIMITS.ip),
    consumeRateLimit(db, `support:order:${digest(normalizeOrderRef(input.ref))}`, SUPPORT_LIMITS.order),
  ]);
  const blocked = decisions.find((d) => !d.allowed);
  if (blocked) {
    return {
      ok: false,
      code: "rate_limited",
      message: "You've sent a few reports already. Please wait a while, or contact us from the help page.",
      retryAfterSeconds: blocked.retryAfterSeconds,
    };
  }

  const order = await findOrderForAccess(db, input.ref, input.access);
  if (!order) return { ok: false, code: "not_found", message: "We couldn't find that order." };

  const allowed = reportableTypes(order);
  if (!allowed.includes(data.type)) {
    const message =
      allowed.length === 0
        ? "This order is not active, so there is nothing to report. If you need help, contact us from the help page."
        : "You can report this once your order is on its way or delivered. Until then, choose \"Something else\" and tell us what you need.";
    return { ok: false, code: "not_reportable", message, fieldErrors: { type: message } };
  }

  const pattern = supportPhotoPathPattern(order.id);
  const photoPaths = [...new Set(data.photoPaths)];
  if (photoPaths.some((p) => !pattern.test(p))) {
    return {
      ok: false,
      code: "invalid",
      message: "One of the photos couldn't be used. Please add it again.",
      fieldErrors: { photoPaths: "One of the photos couldn't be used. Please add it again." },
    };
  }
  if (photoPaths.length > 0) {
    const looked = await Promise.all(photoPaths.map((p) => storage.inspect(p)));
    const bad = looked.some(
      (info) =>
        !info ||
        info.bytes <= 0 ||
        info.bytes > SUPPORT_PHOTO_MAX_BYTES ||
        !(info.contentType in SUPPORT_PHOTO_TYPES),
    );
    if (bad) {
      const message = "One of the photos didn't finish uploading. Please add it again.";
      return { ok: false, code: "invalid", message, fieldErrors: { photoPaths: message } };
    }
  }

  const window = await loadClaimWindow(db, order.id, now);
  // The late flag only concerns reports about the goods; "something else" has no window.
  const late = window.late && data.type !== "other";

  return db.transaction(async (tx): Promise<CreateSupportCaseResult> => {
    // Serialise reports for the same order so the open-case cap cannot be raced past.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`support-case:${order.id}`}))`);
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(supportCases)
      .where(and(eq(supportCases.orderId, order.id), inArray(supportCases.status, ["open", "in_progress"])));
    if ((open?.n ?? 0) >= MAX_OPEN_CASES_PER_ORDER) {
      return {
        ok: false,
        code: "too_many_open",
        message: "We're already looking at a few reports for this order. We'll reply by email; you can add details by replying to that email.",
      };
    }

    const lateNote = late
      ? `Reported ${Math.round(window.hoursSinceDelivery ?? 0)} hours after delivery; the claim window is ${window.hours} hours.`
      : null;
    const [row] = await tx
      .insert(supportCases)
      .values({
        orderId: order.id,
        type: data.type,
        description: data.description,
        photoPaths,
        notes: lateNote,
      })
      .returning({ id: supportCases.id });
    const caseId = (row as { id: string }).id;

    await addOrderEvent(tx, order.id, {
      type: "support_case_opened",
      note: "You told us about a problem with this order. We'll reply by email.",
      visible: true,
      actorId: input.access.kind === "account" ? input.access.userId : null,
    });
    await enqueueAdminAlert(tx, {
      orderId: order.id,
      template: "new_support_case",
      payload: {
        ref: order.ref,
        caseId,
        type: data.type,
        description: late ? `[Late report] ${data.description}`.slice(0, 2000) : data.description,
      },
    });
    await enqueueCustomerNotification(tx, {
      orderId: order.id,
      template: "support_case_update",
      to: order.email,
      payload: {
        ref: order.ref,
        caseId,
        status: "open",
        note: "Thanks for telling us. We'll look at your description and photos and reply by email.",
      },
    });
    await writeAudit(tx, {
      actorId: input.access.kind === "account" ? input.access.userId : null,
      action: "support_case.create",
      entity: "support_case",
      entityId: caseId,
      diff: { ref: order.ref, type: data.type, photos: photoPaths.length, late },
    });
    return { ok: true, caseId, late };
  });
}

/** The customer's own cases on an order (for the order page): type, status and when. */
export async function listSupportCasesForOrder(
  db: DbClient,
  orderId: string,
): Promise<{ id: string; type: SupportType; status: string; resolution: string | null; createdAt: Date }[]> {
  const rows = await db
    .select({
      id: supportCases.id,
      type: supportCases.type,
      status: supportCases.status,
      resolution: supportCases.resolution,
      createdAt: supportCases.createdAt,
    })
    .from(supportCases)
    .where(eq(supportCases.orderId, orderId))
    .orderBy(desc(supportCases.createdAt));
  return rows;
}
