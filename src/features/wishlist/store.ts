import { getWishlistSync } from "./sync";
import {
  WISHLIST_MAX_ITEMS,
  hasEntry,
  mergeWishlists,
  parseWishlist,
  pruneEntries,
  serializeWishlist,
  toggleEntry,
  type WishlistEntry,
} from "./list";

/**
 * Guest wishlist on the device: `localStorage` behind a tiny external store, read with
 * `useSyncExternalStore` (see `useWishlist.ts`). Every storage access is guarded: private windows,
 * blocked site data and quota errors fall back to an in-memory list for the session.
 */

export const WISHLIST_STORAGE_KEY = "ifonli_wishlist_v1";

const EMPTY: readonly WishlistEntry[] = Object.freeze([]);

let entries: readonly WishlistEntry[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function readStorage(): string | null {
  try {
    return globalThis.localStorage?.getItem(WISHLIST_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(next: readonly WishlistEntry[]): void {
  try {
    globalThis.localStorage?.setItem(WISHLIST_STORAGE_KEY, serializeWishlist(next));
  } catch {
    // Storage unavailable: the in-memory copy still works for this page view.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function load(): void {
  if (loaded) return;
  loaded = true;
  entries = parseWishlist(readStorage());
}

function set(next: readonly WishlistEntry[]): void {
  entries = next;
  writeStorage(next);
  emit();
  void getWishlistSync()?.push(next).catch(() => {
    // Account sync is best effort; the device copy stays the source of truth until it succeeds.
  });
}

/** Current entries, newest first. The same array instance until something changes. */
export function getWishlist(): readonly WishlistEntry[] {
  load();
  return entries;
}

export function getServerWishlist(): readonly WishlistEntry[] {
  return EMPTY;
}

export function isInWishlist(id: string): boolean {
  return hasEntry(getWishlist(), id);
}

/** Toggles and returns whether the product is saved afterwards. */
export function toggleWishlist(id: string, now: number = Date.now()): boolean {
  const next = toggleEntry(getWishlist(), id, now);
  set(next);
  return hasEntry(next, id);
}

export function removeFromWishlist(id: string): void {
  const current = getWishlist();
  if (hasEntry(current, id)) set(current.filter((e) => e.id !== id));
}

/** Forgets ids the catalogue no longer knows. No-op when nothing changes. */
export function pruneWishlist(keep: ReadonlySet<string>): void {
  const current = getWishlist();
  const next = pruneEntries(current, keep);
  if (next !== current) set(next);
}

/** Merges an account list into the device list (used by the sync seam after sign-in). */
export function mergeIntoWishlist(incoming: readonly WishlistEntry[]): void {
  set(mergeWishlists(getWishlist(), incoming));
}

/**
 * Makes the device list equal to `incoming` WITHOUT pushing it back (the account list is where it came
 * from). Used once the account is the source of truth, so a removal made on another device sticks.
 */
export function replaceWishlistLocal(incoming: readonly WishlistEntry[]): void {
  load();
  entries = mergeWishlists([], incoming);
  writeStorage(entries);
  emit();
}

/** Empties the device list without touching the account (sign-out: the next person starts clean). */
export function clearWishlistLocal(): void {
  replaceWishlistLocal([]);
}

export function subscribeWishlist(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    // Another tab changed the list: re-read it.
    if (event.key !== null && event.key !== WISHLIST_STORAGE_KEY) return;
    entries = parseWishlist(readStorage());
    loaded = true;
    listener();
  };
  const w = typeof window !== "undefined" ? window : null;
  w?.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    w?.removeEventListener("storage", onStorage);
  };
}

/** Test helper: forget the in-memory copy so the next read goes to storage again. */
export function resetWishlistStoreForTests(): void {
  entries = EMPTY;
  loaded = false;
  listeners.clear();
}

export { WISHLIST_MAX_ITEMS };
