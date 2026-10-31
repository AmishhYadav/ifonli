"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { VIBE_CHANGE_EVENT } from "@/features/vibe/config";
import type { VibeChangeDetail } from "@/features/vibe/store";
import { track } from "@/lib/analytics/client";

import { PRODUCT_SELECTOR, startImpressionObserver, type ImpressionObserver } from "./impressions";

/**
 * Mounted once in the storefront layouts. Renders nothing and never touches the DOM it watches:
 *  - `page_view` on every client-side navigation, plus `view_cart` / `begin_checkout` for those pages;
 *  - `product_impression` through the impression observer (cards are found by `data-product-id`);
 *  - `product_click` through one delegated listener (a click on the link of a card);
 *  - `vibe_switch` from the vibe store's change event (user-driven switches only).
 * PDP views and scroll depth come from `PdpTracker`; everything else is an explicit `track()` call.
 */
export function AnalyticsProvider() {
  const pathname = usePathname();
  const observer = useRef<ImpressionObserver | null>(null);
  const lastPage = useRef<{ path: string; at: number } | null>(null);

  useEffect(() => {
    const now = Date.now();
    // Dev-only double effects (Strict Mode) would otherwise count a page twice.
    if (lastPage.current?.path === pathname && now - lastPage.current.at < 1000) return;
    lastPage.current = { path: pathname, at: now };
    track("page_view", { path: pathname });
    if (pathname === "/cart") track("view_cart", { path: pathname });
    if (pathname === "/checkout") track("begin_checkout", { path: pathname });
    observer.current?.reset();
  }, [pathname]);

  useEffect(() => {
    observer.current = startImpressionObserver((productId, position) => {
      track("product_impression", { productId, meta: { pos: position } });
    });

    const onClick = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const card = target.closest<HTMLElement>(PRODUCT_SELECTOR);
      const link = target.closest("a[href]");
      if (!card || !link || !card.contains(link)) return;
      const productId = card.dataset.productId;
      if (!productId) return;
      const position = Array.from(document.querySelectorAll(PRODUCT_SELECTOR)).indexOf(card);
      track("product_click", { productId, meta: { pos: Math.max(0, position) } });
    };
    document.addEventListener("click", onClick, { capture: true, passive: true });

    const onVibe = (e: Event) => {
      const detail = (e as CustomEvent<VibeChangeDetail>).detail;
      // Restoring the saved vibe or following a shared ?vibe= link is not the visitor switching.
      if (!detail || detail.source === "init" || detail.source === "url") return;
      track("vibe_switch", { vibe: detail.to, meta: { from: detail.from, source: detail.source } });
    };
    window.addEventListener(VIBE_CHANGE_EVENT, onVibe);

    return () => {
      observer.current?.stop();
      observer.current = null;
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener(VIBE_CHANGE_EVENT, onVibe);
    };
  }, []);

  return null;
}
