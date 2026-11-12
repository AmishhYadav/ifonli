import { DIY_MAX_CHARMS } from "@/lib/diy";

/**
 * The DIY pack tray: up to KIT_CHARMS charm picks, held client-side (a shopper's scratch pad until they add the pack
 * to the bag). The pack's free chain is not stored here: the tray always shows it in box 1 and the server adds it.
 * The cart stays the only server truth; nothing here is persisted.
 */

/** Charms a pack holds. */
export const KIT_CHARMS = DIY_MAX_CHARMS;
/** Boxes in the tray: the chain, then the charms. */
export const KIT_SLOTS = KIT_CHARMS + 1;
/** The collection page that builds packs: its cards get an "Add to kit" button. */
export const KIT_TYPE_SLUG = "diy-accessories";

export interface KitItem {
  productId: string;
  variantId: string;
  name: string;
  slug: string;
  imageSrc: string | null;
  pricePaise: number;
}

let items: readonly KitItem[] = [];
const listeners = new Set<() => void>();

function set(next: readonly KitItem[]): void {
  items = next;
  for (const listener of listeners) listener();
}

export function subscribeKit(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getKit(): readonly KitItem[] {
  return items;
}

const EMPTY: readonly KitItem[] = [];
export function getServerKit(): readonly KitItem[] {
  return EMPTY;
}

export function inKit(productId: string): boolean {
  return items.some((i) => i.productId === productId);
}

/** Fills the next free charm box. False when the kit is full or the product is already in it. */
export function addToKit(item: KitItem): boolean {
  if (items.length >= KIT_CHARMS || inKit(item.productId)) return false;
  set([...items, item]);
  return true;
}

export function removeFromKit(productId: string): void {
  set(items.filter((i) => i.productId !== productId));
}

export function clearKit(): void {
  set([]);
}
