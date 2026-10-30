import "server-only";

/**
 * Supabase Storage via its REST API (no supabase-js dependency). Server-only: it uses the
 * service-role key. Buckets: `products`, `cutouts`, `content` (public) and `private`.
 *
 *   GET/POST/PUT  {SUPABASE_URL}/storage/v1/bucket[/id]
 *   POST          {SUPABASE_URL}/storage/v1/object/upload/sign/{bucket}/{path}   (signed upload)
 *   POST          {SUPABASE_URL}/storage/v1/object/sign/{bucket}/{path}          (signed read)
 *   GET           {SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}        (public read)
 */

export const PUBLIC_BUCKETS = ["products", "cutouts", "content"] as const;
export const PRIVATE_BUCKETS = ["private"] as const;
export const ALL_BUCKETS = [...PUBLIC_BUCKETS, ...PRIVATE_BUCKETS] as const;
export type Bucket = (typeof ALL_BUCKETS)[number];
export type PublicBucket = (typeof PUBLIC_BUCKETS)[number];

const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/avif"];

interface BucketSpec {
  id: Bucket;
  public: boolean;
  fileSizeLimit: number;
  allowedMimeTypes: string[];
}

const MB = 1024 * 1024;

/** Bucket configuration. SVG is not allowed in storage (script-capable); placeholders live in public/. */
export const BUCKET_SPECS: readonly BucketSpec[] = [
  { id: "products", public: true, fileSizeLimit: 10 * MB, allowedMimeTypes: IMAGE_MIME },
  { id: "cutouts", public: true, fileSizeLimit: 10 * MB, allowedMimeTypes: IMAGE_MIME },
  { id: "content", public: true, fileSizeLimit: 10 * MB, allowedMimeTypes: IMAGE_MIME },
  {
    id: "private",
    public: false,
    fileSizeLimit: 10 * MB,
    allowedMimeTypes: [...IMAGE_MIME, "application/pdf"],
  },
];

export class StorageError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

function config(): { baseUrl: string; serviceKey: string } {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new StorageError("SUPABASE_URL is not set");
  if (!serviceKey) throw new StorageError("SUPABASE_SERVICE_ROLE_KEY is not set");
  return { baseUrl: `${url.replace(/\/+$/, "")}/storage/v1`, serviceKey };
}

/** Rejects empty, absolute or traversal paths; encodes each segment for use in a URL. */
export function encodeObjectPath(path: string): string {
  const segments = path.split("/");
  if (
    segments.length === 0 ||
    segments.some((s) => s === "" || s === "." || s === "..") ||
    path.startsWith("/")
  ) {
    throw new StorageError(`Invalid storage path "${path}"`);
  }
  return segments.map(encodeURIComponent).join("/");
}

function assertBucket(bucket: string): asserts bucket is Bucket {
  if (!(ALL_BUCKETS as readonly string[]).includes(bucket)) {
    throw new StorageError(`Unknown bucket "${bucket}"`);
  }
}

async function call(
  path: string,
  init: { method: string; body?: unknown },
): Promise<{ status: number; json: unknown }> {
  const { baseUrl, serviceKey } = config();
  const res = await fetch(`${baseUrl}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

function fail(what: string, status: number, json: unknown): never {
  const detail =
    json && typeof json === "object" && "message" in json
      ? String((json as { message: unknown }).message)
      : JSON.stringify(json);
  throw new StorageError(`${what} failed (${status}): ${detail}`, status);
}

export interface EnsureBucketsResult {
  created: Bucket[];
  updated: Bucket[];
}

/** Creates any missing bucket and reconciles public flag, size limit and MIME allow-list. */
export async function ensureBuckets(): Promise<EnsureBucketsResult> {
  const listed = await call("/bucket", { method: "GET" });
  if (listed.status !== 200 || !Array.isArray(listed.json)) {
    fail("Listing buckets", listed.status, listed.json);
  }
  const existing = new Set((listed.json as { id: string }[]).map((b) => b.id));
  const result: EnsureBucketsResult = { created: [], updated: [] };
  for (const spec of BUCKET_SPECS) {
    const body = {
      id: spec.id,
      name: spec.id,
      public: spec.public,
      file_size_limit: spec.fileSizeLimit,
      allowed_mime_types: spec.allowedMimeTypes,
    };
    if (existing.has(spec.id)) {
      const res = await call(`/bucket/${spec.id}`, {
        method: "PUT",
        body: {
          public: spec.public,
          file_size_limit: spec.fileSizeLimit,
          allowed_mime_types: spec.allowedMimeTypes,
        },
      });
      if (res.status !== 200) fail(`Updating bucket ${spec.id}`, res.status, res.json);
      result.updated.push(spec.id);
    } else {
      const res = await call("/bucket", { method: "POST", body });
      if (res.status !== 200 && res.status !== 201) {
        fail(`Creating bucket ${spec.id}`, res.status, res.json);
      }
      result.created.push(spec.id);
    }
  }
  return result;
}

export interface SignedUpload {
  /** Absolute URL the client PUTs the file to (multipart `file` or raw body with Content-Type). */
  url: string;
  token: string;
  bucket: Bucket;
  path: string;
}

/** Signed upload URL (valid for 2 hours, single object path, fails if the object exists). */
export async function createSignedUploadUrl(bucket: string, path: string): Promise<SignedUpload> {
  assertBucket(bucket);
  const encoded = encodeObjectPath(path);
  const res = await call(`/object/upload/sign/${bucket}/${encoded}`, { method: "POST", body: {} });
  const url = (res.json as { url?: string } | null)?.url;
  if (res.status !== 200 || typeof url !== "string") {
    fail("Creating signed upload URL", res.status, res.json);
  }
  const { baseUrl } = config();
  const absolute = url.startsWith("http") ? url : `${baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
  const token = new URL(absolute).searchParams.get("token") ?? "";
  return { url: absolute, token, bucket, path };
}

/** Time-limited read URL, for the private bucket (support photos, invoices) or drafts. */
export async function createSignedReadUrl(
  bucket: string,
  path: string,
  expiresIn: number,
): Promise<string> {
  assertBucket(bucket);
  if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 7 * 24 * 3600) {
    throw new StorageError("expiresIn must be an integer number of seconds between 1 and 604800");
  }
  const encoded = encodeObjectPath(path);
  const res = await call(`/object/sign/${bucket}/${encoded}`, {
    method: "POST",
    body: { expiresIn },
  });
  const signed = (res.json as { signedURL?: string } | null)?.signedURL;
  if (res.status !== 200 || typeof signed !== "string") {
    fail("Creating signed read URL", res.status, res.json);
  }
  const { baseUrl } = config();
  if (signed.startsWith("http")) return signed;
  // Older servers return `/object/sign/...`, newer ones may already include `/storage/v1`.
  const rel = signed.startsWith("/storage/v1") ? signed.slice("/storage/v1".length) : signed;
  return `${baseUrl}${rel.startsWith("/") ? "" : "/"}${rel}`;
}

/** Base URL (no trailing slash) for public objects, from the public Supabase URL. */
export function publicBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url) throw new StorageError("NEXT_PUBLIC_SUPABASE_URL is not set");
  return `${url.replace(/\/+$/, "")}/storage/v1/object/public`;
}

/** Public URL of an object in a public bucket (no network call). */
export function publicUrl(bucket: string, path: string): string {
  assertBucket(bucket);
  if ((PRIVATE_BUCKETS as readonly string[]).includes(bucket)) {
    throw new StorageError(`Bucket "${bucket}" is private; use createSignedReadUrl`);
  }
  return `${publicBaseUrl()}/${bucket}/${encodeObjectPath(path)}`;
}
