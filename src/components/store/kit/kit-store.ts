/**
 * The DIY "build a kit" tray: up to KIT_SLOTS picks, held client-side (a shopper's scratch pad until they add
 * the kit to the bag). The cart stays the only server truth; nothing here is persisted.
 */

export const KIT_SLOTS = 5;
/** Products of this type get an "Add to kit" button. */
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

/** Fills the next free slot. False when the kit is full or the product is already in it. */
export function addToKit(item: KitItem): boolean {
  if (items.length >= KIT_SLOTS || inKit(item.productId)) return false;
  set([...items, item]);
  return true;
}

export function removeFromKit(productId: string): void {
  set(items.filter((i) => i.productId !== productId));
}

export function clearKit(): void {
  set([]);
}
