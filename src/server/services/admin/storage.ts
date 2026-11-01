import "server-only";

import { PRIVATE_BUCKETS, StorageError, publicUrl } from "@/server/storage";

/**
 * Admin-only Storage operations not covered by `src/server/storage` (reading back an uploaded
 * object for validation, deleting objects). Same REST API and service-role key.
 */

function config(): { baseUrl: string; serviceKey: string } {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new StorageError("SUPABASE_URL is not set");
  if (!serviceKey) throw new StorageError("SUPABASE_SERVICE_ROLE_KEY is not set");
  return { baseUrl: `${url.replace(/\/+$/, "")}/storage/v1`, serviceKey };
}

/** Downloads an object from a public bucket (used to validate a just-uploaded image). */
export async function readPublicObject(bucket: string, path: string): Promise<Buffer> {
  const res = await fetch(publicUrl(bucket, path), { cache: "no-store" });
  if (!res.ok)
    throw new StorageError(`Reading ${bucket}/${path} failed (${res.status})`, res.status);
  return Buffer.from(await res.arrayBuffer());
}

/** Deletes objects (Supabase treats missing objects as a no-op). */
export async function deleteStorageObjects(bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  if ((PRIVATE_BUCKETS as readonly string[]).includes(bucket)) {
    throw new StorageError(`Refusing to delete from private bucket "${bucket}"`);
  }
  const { baseUrl, serviceKey } = config();
  const res = await fetch(`${baseUrl}/object/${encodeURIComponent(bucket)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: paths }),
    cache: "no-store",
  });
  if (!res.ok) throw new StorageError(`Deleting from ${bucket} failed (${res.status})`, res.status);
}

/** Writes (or replaces) an object in a bucket with the service key; used to store the cleaned-up copy of an upload. */
export async function writeStorageObject(
  bucket: string,
  path: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const { baseUrl, serviceKey } = config();
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${baseUrl}/object/${encodeURIComponent(bucket)}/${encoded}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": contentType,
      "x-upsert": "true",
      "Cache-Control": "max-age=3600",
    },
    body: new Uint8Array(body),
    cache: "no-store",
  });
  if (!res.ok) throw new StorageError(`Writing ${bucket}/${path} failed (${res.status})`, res.status);
}
