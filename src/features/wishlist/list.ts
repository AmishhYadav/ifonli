/**
 * Pure wishlist list logic (no DOM, no React): parsing what `localStorage` holds, toggling, merging.
 * The device store (`store.ts`) and the future account sync (`sync.ts`) both build on these.
 */

export interface WishlistEntry {
  /** Product id (uuid). Products, not variants: a wishlist heart saves the whole product. */
  id: string;
  /** Epoch milliseconds when it was saved. */
  addedAt: number;
}

/** Hard cap so a runaway script cannot fill storage; the oldest entries fall off first. */
export const WISHLIST_MAX_ITEMS = 100;

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Newest first. Anything malformed in storage is dropped rather than trusted. */
export function parseWishlist(raw: string | null | undefined): WishlistEntry[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const entries: WishlistEntry[] = [];
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const { id, addedAt } = item as { id?: unknown; addedAt?: unknown };
    if (typeof id !== "string" || !ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, addedAt: typeof addedAt === "number" && Number.isFinite(addedAt) ? addedAt : 0 });
  }
  return entries.sort((a, b) => b.addedAt - a.addedAt).slice(0, WISHLIST_MAX_ITEMS);
}

export function serializeWishlist(entries: readonly WishlistEntry[]): string {
  return JSON.stringify(entries);
}

export function hasEntry(entries: readonly WishlistEntry[], id: string): boolean {
  return entries.some((e) => e.id === id);
}

/** Adds `id` at the front when absent, removes it when present. Returns a new array. */
export function toggleEntry(entries: readonly WishlistEntry[], id: string, now: number): WishlistEntry[] {
  if (hasEntry(entries, id)) return entries.filter((e) => e.id !== id);
  return [{ id, addedAt: now }, ...entries].slice(0, WISHLIST_MAX_ITEMS);
}

/** Keeps only the given ids (used to forget products that no longer exist). */
export function pruneEntries(entries: readonly WishlistEntry[], keep: ReadonlySet<string>): WishlistEntry[] {
  const next = entries.filter((e) => keep.has(e.id));
  return next.length === entries.length ? (entries as WishlistEntry[]) : next;
}

/**
 * Union of two lists (device + account): an id in both keeps its EARLIEST save time, the result is
 * newest first. This is what the sync seam uses when a guest signs in.
 */
export function mergeWishlists(a: readonly WishlistEntry[], b: readonly WishlistEntry[]): WishlistEntry[] {
  const byId = new Map<string, WishlistEntry>();
  for (const entry of [...a, ...b]) {
    const existing = byId.get(entry.id);
    if (!existing || entry.addedAt < existing.addedAt) byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((x, y) => y.addedAt - x.addedAt).slice(0, WISHLIST_MAX_ITEMS);
}
