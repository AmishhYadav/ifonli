import { z } from "zod";

import {
  CLIENT_EVENTS,
  LIMITS,
  PDP_SCROLL_MILESTONES,
  PRODUCT_EVENTS,
  SESSION_ID_PATTERN,
  normalizePath,
  type ClientEvent,
} from "@/lib/analytics/events";

const metaValue = z.union([z.string().max(LIMITS.maxMetaValueLength), z.number().finite(), z.boolean()]);

const metaSchema = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,23}$/), metaValue)
  .refine((m) => Object.keys(m).length <= LIMITS.maxMetaKeys, { message: "Too many meta keys" });

const eventSchema = z
  .object({
    event: z.enum(CLIENT_EVENTS),
    productId: z.uuid().optional(),
    vibe: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,31}$/)
      .optional(),
    path: z
      .string()
      .max(LIMITS.maxPathLength * 2)
      .startsWith("/")
      .optional(),
    value: z.number().int().min(0).max(1_000_000).optional(),
    meta: metaSchema.optional(),
  })
  .superRefine((e, ctx) => {
    if (PRODUCT_EVENTS.has(e.event) && !e.productId) {
      ctx.addIssue({ code: "custom", path: ["productId"], message: `${e.event} needs a productId` });
    }
    if (e.event === "pdp_scroll_depth" && !(PDP_SCROLL_MILESTONES as readonly number[]).includes(e.value ?? -1)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Scroll depth must be 25, 50, 75 or 100" });
    }
    if (e.event === "search") {
      if (e.value === undefined) {
        ctx.addIssue({ code: "custom", path: ["value"], message: "search needs the result count in value" });
      }
      const q = e.meta?.q;
      if (q !== undefined && (typeof q !== "string" || q.length > LIMITS.maxSearchTermLength || q.includes("@"))) {
        ctx.addIssue({ code: "custom", path: ["meta", "q"], message: "Unusable search term" });
      }
    }
  });

/** One request body: an anonymous session id and up to 20 events. */
export const eventBatchSchema = z.object({
  sessionId: z.string().regex(SESSION_ID_PATTERN),
  events: z.array(eventSchema).min(1).max(LIMITS.maxBatch),
});

export type EventBatch = z.infer<typeof eventBatchSchema>;

export interface EventRow {
  sessionId: string;
  event: ClientEvent;
  productId: string | null;
  vibe: string | null;
  path: string | null;
  value: number | null;
  meta: Record<string, string | number | boolean> | null;
  ts: Date;
}

/** Validated batch -> table rows. Paths are normalised (no query, order refs masked); admin/api paths are dropped. */
export function toEventRows(batch: EventBatch, now: Date): EventRow[] {
  const rows: EventRow[] = [];
  for (const e of batch.events) {
    const path = e.path ? normalizePath(e.path) : null;
    if (path && (path.startsWith("/admin") || path.startsWith("/api"))) continue;
    rows.push({
      sessionId: batch.sessionId,
      event: e.event,
      productId: e.productId ?? null,
      vibe: e.vibe ?? null,
      path,
      value: e.value ?? null,
      meta: e.meta && Object.keys(e.meta).length > 0 ? e.meta : null,
      ts: now,
    });
  }
  return rows;
}
