import {
  addToCart,
  applyCoupon,
  getCart,
  removeCartItem,
  removeCoupon,
  setCartQuantity,
} from "@/features/cart/actions";
import type { ActionError, ActionResult, CartActionData, CartNotice, CartView } from "@/features/cart/types";

import { summaryAnnouncement } from "./cart-math";

/**
 * Client-side cart state shared by the header badge, the cart drawer, the PDP "Add to cart" and the
 * cart page. The server (cookie + database) is always the truth: this store only holds the last view a
 * Server Action returned, so every surface shows the same cart without prop drilling.
 */

export interface CartStoreState {
  /** Last full cart view, or null until one has been loaded or hydrated. */
  cart: CartView | null;
  /** Item count for the badge; known before the full cart is (it is seeded by the server-rendered header). */
  count: number | null;
  /** Notices from the latest mutation ("Only 2 left - we updated your quantity"). */
  notices: CartNotice[];
  /** Human message of the last failed mutation (cleared by the next one). */
  error: string | null;
  /** Number of Server Actions in flight. */
  busy: number;
  open: boolean;
  /** Text for the polite live region. */
  announcement: string;
}

let state: CartStoreState = {
  cart: null,
  count: null,
  notices: [],
  error: null,
  busy: 0,
  open: false,
  announcement: "",
};
const listeners = new Set<() => void>();

function setState(patch: Partial<CartStoreState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribeCart(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCartState(): CartStoreState {
  return state;
}

const SERVER_STATE: CartStoreState = {
  cart: null,
  count: null,
  notices: [],
  error: null,
  busy: 0,
  open: false,
  announcement: "",
};
export function getServerCartState(): CartStoreState {
  return SERVER_STATE;
}

function dedupe(notices: readonly CartNotice[]): CartNotice[] {
  const seen = new Set<string>();
  return notices.filter((n) => (seen.has(n.message) ? false : (seen.add(n.message), true)));
}

function apply(data: CartActionData, announcement?: string): void {
  setState({
    cart: data.cart,
    count: data.cart.itemCount,
    notices: dedupe(data.notices),
    error: null,
    announcement: announcement ?? summaryAnnouncement(data.cart),
  });
}

async function run(
  call: () => Promise<ActionResult<CartActionData>>,
  announce?: (data: CartActionData) => string,
  /** Keep the failure in the store (for the cart lines). Callers with their own form show `result.error` themselves. */
  surfaceError = false,
): Promise<ActionResult<CartActionData>> {
  setState({ busy: state.busy + 1, error: null });
  try {
    const result = await call();
    if (result.ok) apply(result.data, announce?.(result.data));
    else setState({ error: surfaceError ? result.error.message : null, announcement: result.error.message });
    return result;
  } catch {
    // The request itself failed (offline, server unreachable).
    const error: ActionError = {
      code: "server_error",
      message: "We couldn't reach the shop. Check your connection and try again.",
    };
    setState({ error: surfaceError ? error.message : null, announcement: error.message });
    return { ok: false, error };
  } finally {
    setState({ busy: Math.max(0, state.busy - 1) });
  }
}

/** Seeds the badge from the server-rendered header. Does nothing once the client knows better. */
export function seedCartCount(count: number): void {
  if (state.count === null && state.cart === null) setState({ count });
}

/** Uses a cart view that came with the page (the cart page's server render). */
export function hydrateCart(cart: CartView): void {
  if (state.cart && state.cart.cartId === cart.cartId && state.cart.version > cart.version) return;
  setState({ cart, count: cart.itemCount, notices: dedupe(cart.notices) });
}

/** Loads the cart from the server. A failure is kept in the store so the drawer can offer a retry. */
export async function refreshCart(): Promise<void> {
  await run(() => getCart(), undefined, true);
}

/** What had focus when the drawer opened, so closing it can give focus back (the drawer has no Radix trigger). */
let opener: HTMLElement | null = null;

/** The element to refocus after the drawer closes: its opener if still on the page, else the visible header cart link. */
export function takeCartOpener(): HTMLElement | null {
  const el = opener;
  opener = null;
  if (el && el.isConnected && el.getClientRects().length > 0) return el;
  const triggers = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="cart-button"]'));
  return triggers.find((t) => t.getClientRects().length > 0) ?? null;
}

export function setCartOpen(open: boolean): void {
  if (open === state.open) return;
  if (open && typeof document !== "undefined") {
    const active = document.activeElement;
    opener = active instanceof HTMLElement && active !== document.body ? active : null;
  }
  setState({ open });
  if (open) void refreshCart();
}

export function addItem(variantId: string, qty: number) {
  return run(
    () => addToCart({ variantId, qty }),
    (data) => `Added to bag. ${summaryAnnouncement(data.cart)}`,
  );
}

export function setItemQuantity(variantId: string, qty: number) {
  return run(() => setCartQuantity({ variantId, qty }), undefined, true);
}

export function removeItem(variantId: string) {
  return run(
    () => removeCartItem({ variantId }),
    (data) => `Removed from bag. ${summaryAnnouncement(data.cart)}`,
    true,
  );
}

export function applyCouponCode(code: string) {
  return run(
    () => applyCoupon({ code }),
    (data) => (data.cart.coupon?.applied ? `Coupon ${data.cart.coupon.code} applied.` : "Coupon saved."),
  );
}

export function removeCouponCode() {
  return run(() => removeCoupon(), () => "Coupon removed.");
}
