import "server-only";

import { PRIVATE_BUCKETS, PUBLIC_BUCKETS, publicUrl } from "@/server/storage";

export class ImagePathError extends Error {
  constructor(path: string, reason: string) {
    super(`Cannot resolve image path "${path}": ${reason}`);
    this.name = "ImagePathError";
  }
}

/**
 * Turns a stored image path into a URL for `next/image`:
 *  - `/placeholders/...`  site-relative file under `public/`, returned unchanged;
 *  - `https://...`        already absolute, returned unchanged;
 *  - `products/<id>/x.webp`  `bucket/object-path` in a PUBLIC Supabase Storage bucket, resolved to
 *    its public URL (host must be allowed in `next.config.ts` `images.remotePatterns`).
 * Protocol-relative (`//host`), traversal (`..`), unknown and private buckets throw.
 */
export function resolveImageUrl(path: string): string {
  const p = path.trim();
  if (!p) throw new ImagePathError(path, "empty");
  if (p.startsWith("//")) throw new ImagePathError(path, "protocol-relative URLs are not allowed");
  if (p.startsWith("/")) {
    if (p.split("/").includes("..")) throw new ImagePathError(path, "path traversal");
    return p;
  }
  if (/^https?:\/\//i.test(p)) return p;
  const slash = p.indexOf("/");
  if (slash < 1 || slash === p.length - 1) {
    throw new ImagePathError(path, "expected 'bucket/object-path'");
  }
  const bucket = p.slice(0, slash);
  const objectPath = p.slice(slash + 1);
  if ((PRIVATE_BUCKETS as readonly string[]).includes(bucket)) {
    throw new ImagePathError(path, "private bucket");
  }
  if (!(PUBLIC_BUCKETS as readonly string[]).includes(bucket)) {
    throw new ImagePathError(path, `unknown bucket "${bucket}"`);
  }
  try {
    return publicUrl(bucket, objectPath);
  } catch (error) {
    throw new ImagePathError(path, error instanceof Error ? error.message : "invalid path");
  }
}

/** Props for `<Image>` from an image reference (`ProductCard.image` etc.). */
export function imageProps(image: {
  path: string;
  alt: string;
  width: number | null;
  height: number | null;
}): { src: string; alt: string; width: number; height: number } {
  return {
    src: resolveImageUrl(image.path),
    alt: image.alt,
    width: image.width ?? 800,
    height: image.height ?? 800,
  };
}
