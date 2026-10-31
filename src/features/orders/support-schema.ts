import { z } from "zod";

/**
 * "Report a problem" rules that the browser and the server share. Pure (no server imports): the
 * order-page form validates with these before uploading anything, the support-case service validates
 * again.
 */

export const SUPPORT_TYPES = ["damaged", "defective", "wrong", "missing", "other"] as const;
export type SupportType = (typeof SUPPORT_TYPES)[number];

export const SUPPORT_TYPE_LABELS: Record<SupportType, string> = {
  damaged: "It arrived damaged",
  defective: "It doesn't work or is faulty",
  wrong: "I got the wrong item",
  missing: "Something is missing",
  other: "Something else",
};

export const SUPPORT_DESCRIPTION_MIN = 10;
export const SUPPORT_DESCRIPTION_MAX = 2000;
export const SUPPORT_PHOTO_MAX = 4;
export const SUPPORT_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
/** What phones and browsers produce; the private bucket allows these (and PDF, which is not offered here). */
export const SUPPORT_PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
export type SupportPhotoType = keyof typeof SUPPORT_PHOTO_TYPES;

export const supportCaseSchema = z.object({
  type: z.enum(SUPPORT_TYPES, { error: "Choose what went wrong" }),
  description: z
    .string({ error: "Tell us what happened" })
    .trim()
    .min(SUPPORT_DESCRIPTION_MIN, `Write at least ${SUPPORT_DESCRIPTION_MIN} characters so we can help`)
    .max(SUPPORT_DESCRIPTION_MAX, `Keep it under ${SUPPORT_DESCRIPTION_MAX} characters`),
  photoPaths: z
    .array(z.string().max(200))
    .max(SUPPORT_PHOTO_MAX, `You can add up to ${SUPPORT_PHOTO_MAX} photos`)
    .default([]),
});
export type SupportCaseInput = z.input<typeof supportCaseSchema>;
export type SupportField = "type" | "description" | "photoPaths";

export interface SupportPhotoFile {
  type: string;
  size: number;
}

/** Pure check of the files a customer wants to attach. Returns a message, or null when fine. */
export function validatePhotoFiles(files: readonly SupportPhotoFile[]): string | null {
  if (files.length > SUPPORT_PHOTO_MAX) return `You can add up to ${SUPPORT_PHOTO_MAX} photos.`;
  for (const file of files) {
    if (!(file.type in SUPPORT_PHOTO_TYPES)) return "Photos must be JPEG, PNG or WebP images.";
    if (!Number.isFinite(file.size) || file.size <= 0) return "One of the photos is empty.";
    if (file.size > SUPPORT_PHOTO_MAX_BYTES) {
      return `Each photo can be up to ${Math.round(SUPPORT_PHOTO_MAX_BYTES / (1024 * 1024))} MB. Try a smaller one.`;
    }
  }
  return null;
}

/** Reports about the goods themselves make sense once the parcel is on its way or has arrived. */
export const PARCEL_TYPES: readonly SupportType[] = ["damaged", "defective", "wrong", "missing"];
export const PARCEL_STATES: readonly string[] = ["shipped", "out_for_delivery", "delivered", "rto", "returned"];
export const REPORTABLE_STATUSES: readonly string[] = ["confirmed", "processing", "completed"];

/** Which report types an order can take right now (the UI offers these; the service enforces the same rule). */
export function reportableTypes(order: { status: string; fulfillmentStatus: string }): SupportType[] {
  if (!REPORTABLE_STATUSES.includes(order.status)) return [];
  const parcel = PARCEL_STATES.includes(order.fulfillmentStatus);
  return SUPPORT_TYPES.filter((t) => parcel || !PARCEL_TYPES.includes(t));
}
