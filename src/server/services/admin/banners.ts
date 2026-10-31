import "server-only";

import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { assertCan } from "@/server/auth/permissions";
import { banners, vibes } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import type { DbClient } from "@/server/services/queries/shared";
import { createSignedUploadUrl, type SignedUpload } from "@/server/storage";

import { inspectImage } from "./product-images";
import { diffFields } from "./product-schema";
import { AdminInputError, type AdminActor } from "./products";
import { deleteStorageObjects, readPublicObject } from "./storage";

/**
 * Admin banners: `home_offer` cards on the home page (global or per vibe) and the single-line
 * `announcement` bar (always global; the storefront shows the first live one). Every function checks
 * `content:*` itself and writes an audit row in the same transaction. The caller expires the
 * storefront cache with `revalidateContent()`.
 */

export type BannerPlacement = (typeof banners.$inferSelect)["placement"];
export const BANNER_PLACEMENTS = ["home_offer", "announcement"] as const satisfies readonly BannerPlacement[];

export type BannerState = "live" | "scheduled" | "expired" | "inactive";

/** Where uploaded banner images live: public `content` bucket, `banners/` prefix (`bucket/object-path`). */
export const BANNER_IMAGE_PREFIX = "content/banners/";
const BANNER_IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "avif"];

const optionalText = (max: number) =>
  z
    .string()
    .max(max, `At most ${max} characters`)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null));

/** Relative `/path` (not protocol-relative) or `https://` URL. */
export const bannerLinkSchema = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine(
    (v) => v === null || (v.startsWith("/") && !v.startsWith("//") && !/\s/.test(v)) || /^https:\/\/[^\s]+$/i.test(v),
    "Use a path on this site (like /shop) or a full https:// link",
  );

const dateInput = z
  .union([z.date(), z.iso.datetime({ offset: true, message: "Not a valid date and time" })])
  .nullish()
  .transform((v) => (v ? new Date(v) : null))
  .refine((v) => v === null || !Number.isNaN(v.getTime()), "Not a valid date and time");

export const bannerInputSchema = z
  .object({
    placement: z.enum(BANNER_PLACEMENTS),
    vibeId: z.uuid().nullish().transform((v) => v ?? null),
    title: z.string().trim().min(1, "Title is required").max(120, "At most 120 characters"),
    body: optionalText(300),
    imagePath: z
      .string()
      .trim()
      .max(300)
      .nullish()
      .transform((v) => (v ? v : null))
      .refine(
        (v) => v === null || (v.startsWith(BANNER_IMAGE_PREFIX) && !v.includes("..") && /^[A-Za-z0-9/_.-]+$/.test(v)),
        "Unexpected image path",
      ),
    link: bannerLinkSchema,
    startsAt: dateInput,
    endsAt: dateInput,
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The end must be after the start" });
    }
    if (v.placement === "announcement" && v.vibeId) {
      ctx.addIssue({
        code: "custom",
        path: ["vibeId"],
        message: "The announcement bar is shown in every vibe",
      });
    }
    if (v.placement === "announcement" && v.imagePath) {
      ctx.addIssue({ code: "custom", path: ["imagePath"], message: "The announcement bar has no image" });
    }
  });
export type BannerInput = z.input<typeof bannerInputSchema>;

export interface AdminBanner {
  id: string;
  placement: BannerPlacement;
  vibeId: string | null;
  vibeName: string | null;
  title: string;
  body: string | null;
  imagePath: string | null;
  link: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  position: number;
  active: boolean;
  state: BannerState;
  createdAt: Date;
}

/** Whether the storefront query would show this banner at `now` (ignoring vibe). */
export function bannerState(
  b: { active: boolean; startsAt: Date | null; endsAt: Date | null },
  now: Date,
): BannerState {
  if (!b.active) return "inactive";
  if (b.startsAt && b.startsAt > now) return "scheduled";
  if (b.endsAt && b.endsAt <= now) return "expired";
  return "live";
}

/** Same order the storefront uses (position, then newest). */
export async function listBanners(
  db: DbClient,
  opts: { placement?: BannerPlacement; now?: Date } = {},
): Promise<AdminBanner[]> {
  const now = opts.now ?? new Date();
  const rows = await db
    .select({ banner: banners, vibeName: vibes.name })
    .from(banners)
    .leftJoin(vibes, eq(banners.vibeId, vibes.id))
    .where(opts.placement ? eq(banners.placement, opts.placement) : undefined)
    .orderBy(asc(banners.position), desc(banners.createdAt), asc(banners.id));
  return rows.map(({ banner: b, vibeName }) => ({
    id: b.id,
    placement: b.placement,
    vibeId: b.vibeId,
    vibeName,
    title: b.title,
    body: b.body,
    imagePath: b.imagePath,
    link: b.link,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    position: b.position,
    active: b.active,
    state: bannerState(b, now),
    createdAt: b.createdAt,
  }));
}

async function assertVibeExists(db: DbClient, vibeId: string | null): Promise<void> {
  if (!vibeId) return;
  const [v] = await db.select({ id: vibes.id }).from(vibes).where(eq(vibes.id, vibeId));
  if (!v) throw new AdminInputError("Vibe not found");
}

function snapshot(b: {
  placement: string;
  vibeId: string | null;
  title: string;
  body: string | null;
  imagePath: string | null;
  link: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
}): Record<string, unknown> {
  return {
    placement: b.placement,
    vibeId: b.vibeId,
    title: b.title,
    body: b.body,
    imagePath: b.imagePath,
    link: b.link,
    startsAt: b.startsAt?.toISOString() ?? null,
    endsAt: b.endsAt?.toISOString() ?? null,
    active: b.active,
  };
}

/** Deletes an uploaded image from storage once no banner points at it any more (best effort). */
async function dropOrphanImage(db: DbClient, path: string | null): Promise<void> {
  if (!path || !path.startsWith(BANNER_IMAGE_PREFIX)) return;
  const [still] = await db.select({ id: banners.id }).from(banners).where(eq(banners.imagePath, path)).limit(1);
  if (still) return;
  await deleteStorageObjects("content", [path.slice("content/".length)]).catch(() => undefined);
}

export async function createBanner(
  db: DbClient,
  raw: unknown,
  actor: AdminActor,
): Promise<{ id: string }> {
  assertCan(actor.role, "content:manage");
  const input = bannerInputSchema.parse(raw);
  await assertVibeExists(db, input.vibeId);
  return db.transaction(async (tx) => {
    const [last] = await tx
      .select({ pos: sql<number | null>`max(${banners.position})` })
      .from(banners)
      .where(eq(banners.placement, input.placement));
    // New banners go last; the admin moves them up with the arrows.
    const [row] = await tx
      .insert(banners)
      .values({ ...input, position: (last?.pos ?? -1) + 1 })
      .returning({ id: banners.id });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "banner.create",
      entity: "banner",
      entityId: row!.id,
      diff: snapshot(input),
      ip: actor.ip,
    });
    return { id: row!.id };
  });
}

export async function updateBanner(
  db: DbClient,
  bannerId: string,
  raw: unknown,
  actor: AdminActor,
): Promise<{ id: string }> {
  assertCan(actor.role, "content:manage");
  const input = bannerInputSchema.parse(raw);
  await assertVibeExists(db, input.vibeId);
  const oldImage = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(banners).where(eq(banners.id, bannerId)).for("update");
    if (!before) throw new AdminInputError("Banner not found");
    if (before.placement !== input.placement) {
      throw new AdminInputError("A banner cannot move between the home page and the announcement bar");
    }
    await tx.update(banners).set(input).where(eq(banners.id, bannerId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "banner.update",
      entity: "banner",
      entityId: bannerId,
      diff: diffFields(snapshot(before), snapshot(input)),
      ip: actor.ip,
    });
    return before.imagePath !== input.imagePath ? before.imagePath : null;
  });
  await dropOrphanImage(db, oldImage);
  return { id: bannerId };
}

export async function setBannerActive(
  db: DbClient,
  bannerId: string,
  active: boolean,
  actor: AdminActor,
): Promise<void> {
  assertCan(actor.role, "content:manage");
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(banners).where(eq(banners.id, bannerId)).for("update");
    if (!before) throw new AdminInputError("Banner not found");
    if (before.active === active) return;
    await tx.update(banners).set({ active }).where(eq(banners.id, bannerId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "banner.update",
      entity: "banner",
      entityId: bannerId,
      diff: { active: { from: before.active, to: active } },
      ip: actor.ip,
    });
  });
}

export async function deleteBanner(db: DbClient, bannerId: string, actor: AdminActor): Promise<void> {
  assertCan(actor.role, "content:manage");
  const image = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(banners).where(eq(banners.id, bannerId)).for("update");
    if (!before) throw new AdminInputError("Banner not found");
    await tx.delete(banners).where(eq(banners.id, bannerId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "banner.delete",
      entity: "banner",
      entityId: bannerId,
      diff: snapshot(before),
      ip: actor.ip,
    });
    return before.imagePath;
  });
  await dropOrphanImage(db, image);
}

/**
 * Moves a banner one step up or down within its placement. Positions are first normalised to
 * 0..n-1 in the order the storefront uses, then two neighbours swap.
 */
export async function moveBanner(
  db: DbClient,
  bannerId: string,
  direction: "up" | "down",
  actor: AdminActor,
): Promise<void> {
  assertCan(actor.role, "content:manage");
  await db.transaction(async (tx) => {
    const [target] = await tx.select().from(banners).where(eq(banners.id, bannerId));
    if (!target) throw new AdminInputError("Banner not found");
    // Serialise concurrent moves of the same placement.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"banners:" + target.placement}))`);
    const siblings = await tx
      .select({ id: banners.id, position: banners.position })
      .from(banners)
      .where(eq(banners.placement, target.placement))
      .orderBy(asc(banners.position), desc(banners.createdAt), asc(banners.id));
    const order = siblings.map((s) => s.id);
    const i = order.indexOf(bannerId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    for (const [position, id] of order.entries()) {
      const current = siblings.find((s) => s.id === id)!;
      if (current.position !== position) {
        await tx.update(banners).set({ position }).where(eq(banners.id, id));
      }
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: "banner.reorder",
      entity: "banner",
      entityId: bannerId,
      diff: { placement: target.placement, direction, order },
      ip: actor.ip,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Image upload (public `content` bucket), same two-step flow as product images.
// ---------------------------------------------------------------------------------------------

export interface PreparedBannerUpload extends SignedUpload {
  /** Value for `banners.image_path` (`content/banners/<uuid>.<ext>`). */
  dbPath: string;
}

/** Step 1: a signed URL the browser PUTs the file to. Nothing is recorded yet. */
export async function prepareBannerImageUpload(
  input: { extension: string },
  actor: AdminActor,
): Promise<PreparedBannerUpload> {
  assertCan(actor.role, "content:manage");
  const ext = input.extension.toLowerCase().replace(/^\./, "");
  if (!BANNER_IMAGE_EXT.includes(ext)) {
    throw new AdminInputError("Banner images must be JPEG, PNG, WebP or AVIF");
  }
  const objectPath = `banners/${crypto.randomUUID()}.${ext}`;
  const upload = await createSignedUploadUrl("content", objectPath);
  return { ...upload, dbPath: `content/${objectPath}` };
}

/**
 * Step 2: reads the uploaded object back and checks it is a real image (deleting it if not).
 * The path is then saved with the banner.
 */
export async function verifyBannerImage(
  input: { dbPath: string },
  actor: AdminActor,
): Promise<{ dbPath: string; width: number; height: number; warnings: string[] }> {
  assertCan(actor.role, "content:manage");
  if (
    !input.dbPath.startsWith(BANNER_IMAGE_PREFIX) ||
    input.dbPath.includes("..") ||
    !/^[A-Za-z0-9/_.-]+$/.test(input.dbPath)
  ) {
    throw new AdminInputError("Unexpected upload path");
  }
  const objectPath = input.dbPath.slice("content/".length);
  try {
    const info = await inspectImage(await readPublicObject("content", objectPath), "photo");
    return { dbPath: input.dbPath, width: info.width, height: info.height, warnings: info.warnings };
  } catch (error) {
    await deleteStorageObjects("content", [objectPath]).catch(() => undefined);
    throw error;
  }
}

/** The announcement the storefront bar shows right now (the first live global one), for the "showing now" marker. */
export function liveAnnouncementId(list: readonly AdminBanner[]): string | null {
  return list.find((b) => b.placement === "announcement" && b.state === "live" && b.vibeId === null)?.id ?? null;
}
