import "server-only";

import { and, eq, inArray, lt, notInArray, or, sql } from "drizzle-orm";

import { contactMessages, supportCases } from "@/server/db/schema";
import { listObjects, StorageError } from "@/server/storage";

import { removeSupportPhotos, SUPPORT_TEXT_REMOVED } from "./dpdp";
import type { DbClient } from "./queries/shared";
import { supportPhotoPathPattern } from "./support-cases";

/**
 * Personal-data retention for the daily cleanup cron (DPDP Act 2023: keep personal data no longer than
 * the purpose needs). The periods below are conservative placeholders the owner confirms with their
 * lawyer (docs/OWNER-INPUTS.md); changing one is a one-line edit here.
 *
 * NOT purged, on purpose: orders, order lines, shipments, invoices, refunds and the name, address,
 * e-mail and phone on them. They are tax and accounting records (GST invoices and books of account are
 * kept about 8 years under the CGST Act and the Companies Act) and the evidence trail for consumer
 * disputes. A customer who deletes their account has those orders detached from it, not erased
 * (`dpdp.ts`).
 *
 * Every step is bounded (batch limit) so the cron stays inside its time budget; a backlog is worked
 * off over the following nights, and each step reports how many rows it handled.
 */

/** Contact-form messages that were dealt with (status `closed`) are deleted this long after their last change. */
export const CONTACT_MESSAGE_RETENTION_DAYS = 365;

/** A resolved or rejected support case keeps its description and photos this long after its last change. */
export const SUPPORT_CASE_RETENTION_DAYS = 365;

/** Replaces the free text of a support case erased by the retention job (the account-deletion marker says "customer's request"). */
export const SUPPORT_TEXT_EXPIRED = "[Removed after the retention period]";

/** Rows handled per step per run. */
export const RETENTION_BATCH = 500;

/** A photo is only an orphan after this long: the upload, then the case that links it, normally follow within minutes. */
export const ORPHAN_PHOTO_GRACE_MS = 86_400_000;

const DAY_MS = 86_400_000;

/** Deletes closed contact messages (name, e-mail, phone and text) past the retention period. */
export async function purgeClosedContactMessages(db: DbClient, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - CONTACT_MESSAGE_RETENTION_DAYS * DAY_MS);
  const due = await db
    .select({ id: contactMessages.id })
    .from(contactMessages)
    .where(and(eq(contactMessages.status, "closed"), lt(contactMessages.updatedAt, cutoff)))
    .limit(RETENTION_BATCH);
  if (due.length === 0) return 0;
  const gone = await db
    .delete(contactMessages)
    .where(and(inArray(contactMessages.id, due.map((m) => m.id)), eq(contactMessages.status, "closed")))
    .returning({ id: contactMessages.id });
  return gone.length;
}

/**
 * Erases what the customer wrote on support cases closed (resolved or rejected) long enough ago: the
 * description is replaced with a marker and the photos are deleted from storage. The case row, its type,
 * status, resolution, the team's notes and the link to the order stay (the order holds the customer's
 * contact details and is a retained accounting record; a refund or replacement is linked through it).
 * Photos are removed after the database commit like in account deletion; if storage is down the paths
 * are already gone from the row and `sweepOrphanSupportPhotos` finds the objects later.
 */
export async function purgeClosedSupportCases(
  db: DbClient,
  now: Date,
  deps: { removePhotos?: (paths: string[]) => Promise<void> } = {},
): Promise<number> {
  const cutoff = new Date(now.getTime() - SUPPORT_CASE_RETENTION_DAYS * DAY_MS);
  const photoPaths: string[] = [];
  const erased = await db.transaction(async (tx) => {
    const due = await tx
      .select({ id: supportCases.id, paths: supportCases.photoPaths })
      .from(supportCases)
      .where(
        and(
          inArray(supportCases.status, ["resolved", "rejected"]),
          lt(supportCases.updatedAt, cutoff),
          // Not yet erased (by this job or by account deletion), or photos left behind.
          or(
            notInArray(supportCases.description, [SUPPORT_TEXT_EXPIRED, SUPPORT_TEXT_REMOVED]),
            sql`cardinality(${supportCases.photoPaths}) > 0`,
          ),
        ),
      )
      .limit(RETENTION_BATCH)
      .for("update", { skipLocked: true });
    if (due.length === 0) return 0;
    for (const c of due) photoPaths.push(...c.paths);
    // `updated_at` is bumped too, which only restarts a clock the marker filter above already ignores.
    await tx
      .update(supportCases)
      .set({ description: SUPPORT_TEXT_EXPIRED, photoPaths: [] })
      .where(inArray(supportCases.id, due.map((c) => c.id)));
    return due.length;
  });
  if (photoPaths.length > 0) {
    try {
      await (deps.removePhotos ?? removeSupportPhotos)(photoPaths);
    } catch (e) {
      console.error(`retention: ${photoPaths.length} support photos could not be removed`, e instanceof Error ? e.name : "unknown");
    }
  }
  return erased;
}

/* ------------------------------------------------------------------------------------------ */
/* Orphaned support photos                                                                    */
/* ------------------------------------------------------------------------------------------ */

/** What the sweep needs from Storage (the private bucket), injectable for tests. */
export interface PhotoSweepStorage {
  /** False when Supabase Storage is not configured (local dev): the sweep does nothing. */
  configured(): boolean;
  /** Names of the `support/{orderId}` folders, one page, sorted. */
  listFolders(offset: number, limit: number): Promise<string[]>;
  /** The photos in one folder with their upload time. */
  listPhotos(orderId: string): Promise<{ name: string; createdAt: Date | null }[]>;
  remove(paths: string[]): Promise<void>;
}

export const supabasePhotoSweepStorage: PhotoSweepStorage = {
  configured: () =>
    Boolean((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY),
  async listFolders(offset, limit) {
    const rows = await listObjects("private", "support", { limit, offset });
    return rows.filter((r) => r.isFolder).map((r) => r.name);
  },
  async listPhotos(orderId) {
    const rows = await listObjects("private", `support/${orderId}`, { limit: 100 });
    return rows.filter((r) => !r.isFolder).map((r) => ({ name: r.name, createdAt: r.createdAt }));
  },
  remove: removeSupportPhotos,
};

/** Order folders looked at per run. Storage cannot list "everything unreferenced", so the sweep walks a window. */
export const SWEEP_FOLDERS_PER_RUN = 100;
/** The window start moves on by one run's worth each day and wraps here, so ~10,000 order folders are covered every ~100 days. */
export const SWEEP_CYCLE_FOLDERS = 10_000;
/** Orphans deleted per run. */
export const SWEEP_MAX_DELETES = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Deletes support photos that no support case references (KNOWN-ISSUES S-1): uploads whose case was
 * never submitted, and photos left in Storage when an account deletion or the retention purge above
 * could not reach them. Only `support/{orderId}/{uuid}.{ext}` objects older than a day are touched, and
 * only after checking the cases of that order, so a photo that is attached is never deleted.
 *
 * It looks at one window of `SWEEP_FOLDERS_PER_RUN` order folders per run, starting at a position that
 * advances daily (stateless: derived from the date) and restarts at the first folder once the window
 * runs past the end. Returns the number of objects deleted.
 */
export async function sweepOrphanSupportPhotos(
  db: DbClient,
  now: Date,
  storage: PhotoSweepStorage = supabasePhotoSweepStorage,
): Promise<number> {
  if (!storage.configured()) return 0;
  try {
    const day = Math.floor(now.getTime() / DAY_MS);
    let folders = await storage.listFolders((day * SWEEP_FOLDERS_PER_RUN) % SWEEP_CYCLE_FOLDERS, SWEEP_FOLDERS_PER_RUN);
    if (folders.length === 0) folders = await storage.listFolders(0, SWEEP_FOLDERS_PER_RUN);

    const orphans: string[] = [];
    for (const orderId of folders) {
      if (orphans.length >= SWEEP_MAX_DELETES) break;
      if (!UUID.test(orderId)) continue;
      const pattern = supportPhotoPathPattern(orderId);
      const photos = await storage.listPhotos(orderId);
      const old = photos
        .map((p) => ({ path: `support/${orderId}/${p.name}`, createdAt: p.createdAt }))
        .filter((p) => pattern.test(p.path) && p.createdAt && now.getTime() - p.createdAt.getTime() > ORPHAN_PHOTO_GRACE_MS);
      if (old.length === 0) continue;
      const cases = await db
        .select({ paths: supportCases.photoPaths })
        .from(supportCases)
        .where(eq(supportCases.orderId, orderId));
      const linked = new Set(cases.flatMap((c) => c.paths));
      for (const p of old) if (!linked.has(p.path)) orphans.push(p.path);
    }
    const batch = orphans.slice(0, SWEEP_MAX_DELETES);
    for (let i = 0; i < batch.length; i += 100) await storage.remove(batch.slice(i, i + 100));
    return batch.length;
  } catch (e) {
    // Storage hiccups must not fail the rest of the nightly cleanup; tomorrow's run tries again.
    console.error("retention: orphan photo sweep failed", e instanceof StorageError ? e.message : e instanceof Error ? e.name : "unknown");
    return 0;
  }
}
