/**
 * First-party analytics vocabulary shared by the browser helper and the ingest route (plan 12).
 * Plain TypeScript on purpose: no Zod, no server imports, so it adds almost nothing to the client bundle.
 * The strict runtime validation lives in `src/server/services/analytics/schema.ts`.
 */

/** Events a browser may send. */
export const CLIENT_EVENTS = [
  "page_view",
  "product_impression",
  "product_click",
  "pdp_view",
  "pdp_scroll_depth",
  "add_to_cart",
  "remove_from_cart",
  "view_cart",
  "begin_checkout",
  "add_shipping_info",
  "add_payment_info",
  "vibe_switch",
  "hero_impression",
  "hero_play",
  "hero_pause",
  "hero_tile_click",
  "search",
  "wishlist_add",
] as const;
export type ClientEvent = (typeof CLIENT_EVENTS)[number];

/**
 * Events only the server writes (inside the order transactions). The ingest route rejects them, so a
 * visitor cannot forge a purchase.
 *  - `purchase`: one per order, `value` = order total in paise, `meta.orderId`.
 *  - `purchase_item`: one per product in the order, `value` = line revenue in paise, `meta.orderId`, `meta.qty`.
 *  - `order_placed`: written at placement (prepaid and COD) to remember the analytics session of the order.
 */
export const SERVER_EVENTS = ["purchase", "purchase_item", "order_placed"] as const;
export type ServerEvent = (typeof SERVER_EVENTS)[number];

export type AnalyticsEventName = ClientEvent | ServerEvent;

/** Share of the PDP content area scrolled into view, in percent. */
export const PDP_SCROLL_MILESTONES = [25, 50, 75, 100] as const;

/** Events that are about one product and must say which. */
export const PRODUCT_EVENTS: ReadonlySet<ClientEvent> = new Set<ClientEvent>([
  "product_impression",
  "product_click",
  "pdp_view",
  "pdp_scroll_depth",
  "add_to_cart",
  "remove_from_cart",
  "wishlist_add",
]);

export const LIMITS = {
  /** Events per request. */
  maxBatch: 20,
  /** Request body, bytes. */
  maxBodyBytes: 8 * 1024,
  maxPathLength: 200,
  maxMetaKeys: 8,
  maxMetaValueLength: 100,
  maxSearchTermLength: 80,
} as const;

/** The anonymous per-tab session id (also mirrored into a session cookie so server actions can link orders). */
export const SESSION_COOKIE = "ifonli_sid";
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
/** A visit ends after this long without an event. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;

/** Consent cookie for the optional GA4 (no personal data in it). */
export const CONSENT_COOKIE = "ifonli_consent";
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
export const CONSENT_OPEN_EVENT = "ifonli:consent-open";
export type ConsentChoice = "granted" | "denied";

export type MetaValue = string | number | boolean;
export type EventMeta = Record<string, MetaValue>;

export interface TrackProps {
  productId?: string;
  /** Defaults to the active vibe (`html[data-vibe]`). For `vibe_switch` it is the vibe switched TO. */
  vibe?: string;
  /** Defaults to the current pathname. */
  path?: string;
  /** Meaning depends on the event: scroll milestone, quantity, result count, ... */
  value?: number;
  meta?: EventMeta;
}

export interface WireEvent extends TrackProps {
  event: ClientEvent;
}

/**
 * Keeps only the path: no query, no hash, and order references are masked so a confirmation URL never
 * lands in the table. Always starts with "/" and is capped in length.
 */
export function normalizePath(input: string): string {
  let p = input.split("#")[0]!.split("?")[0]!.trim();
  if (!p.startsWith("/")) p = `/${p}`;
  // Guest confirmation pages and the signed-in account pages both carry the order reference in the path.
  p = p.replace(/^\/orders\/[^/]+/, "/orders/:ref").replace(/^\/account\/orders\/[^/]+/, "/account/orders/:ref");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p.slice(0, LIMITS.maxPathLength) || "/";
}

/**
 * Search terms are free text, so they can contain personal data. A term is kept (lower-cased, spaces
 * collapsed, capped) unless it looks like an e-mail address or a phone-length number; then it is dropped.
 */
export function normalizeSearchTerm(input: string): string | null {
  const t = input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITS.maxSearchTermLength);
  if (t.length < 1) return null;
  if (t.includes("@")) return null;
  if (/\d[\d\s().-]{5,}\d/.test(t)) return null;
  return t;
}

/** Percent of `contentHeight` that is visible when the content's top is at `top` in a viewport of `viewportHeight`. */
export function scrollDepthPercent(top: number, contentHeight: number, viewportHeight: number): number {
  if (!(contentHeight > 0)) return 0;
  const seen = Math.min(contentHeight, Math.max(0, viewportHeight - top));
  return Math.min(100, (seen / contentHeight) * 100);
}

/** Milestones newly reached at `percent` (half a percent of tolerance for sub-pixel layout). */
export function newMilestones(percent: number, alreadyReached: number): number[] {
  return PDP_SCROLL_MILESTONES.filter((m) => m > alreadyReached && percent >= m - 0.5);
}

/** GA4 recommended e-commerce event names (null = not mirrored). */
export const GA4_EVENT_NAMES: Record<ClientEvent, string | null> = {
  page_view: "page_view",
  product_impression: "view_item_list",
  product_click: "select_item",
  pdp_view: "view_item",
  pdp_scroll_depth: "scroll",
  add_to_cart: "add_to_cart",
  remove_from_cart: "remove_from_cart",
  view_cart: "view_cart",
  begin_checkout: "begin_checkout",
  add_shipping_info: "add_shipping_info",
  add_payment_info: "add_payment_info",
  vibe_switch: "vibe_switch",
  hero_impression: null,
  hero_play: null,
  hero_pause: null,
  hero_tile_click: "hero_tile_click",
  search: "search",
  wishlist_add: "add_to_wishlist",
};

/** The GA4 call for an event, or null when it is not mirrored. Product ids are the only item data we hold client-side. */
export function toGa4Event(e: WireEvent): { name: string; params: Record<string, unknown> } | null {
  const name = GA4_EVENT_NAMES[e.event];
  if (!name) return null;
  const params: Record<string, unknown> = {};
  if (e.productId) {
    params.items = [{ item_id: e.productId, ...((e.event === "add_to_cart" || e.event === "remove_from_cart") && e.value ? { quantity: e.value } : {}) }];
  }
  if (e.event === "search" && typeof e.meta?.q === "string") params.search_term = e.meta.q;
  if (e.event === "pdp_scroll_depth" && e.value) params.percent_scrolled = e.value;
  if (e.event === "vibe_switch" && e.vibe) params.vibe = e.vibe;
  if (e.event === "hero_tile_click" && e.meta?.tile !== undefined) params.tile = e.meta.tile;
  if (e.event === "page_view" && e.path) params.page_path = e.path;
  return { name, params };
}
