"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import type { CartDrawerProps } from "./CartDrawerPanel";
import { useCartStore } from "./useCart";

/** Starts the download of the drawer code (the header link calls this on hover, focus and touch). */
export function preloadCartDrawer(): Promise<unknown> {
  return import("./CartDrawerPanel");
}

const Panel = dynamic(() => import("./CartDrawerPanel").then((m) => m.CartDrawerPanel), { ssr: false });

/**
 * Right-hand cart drawer, driven by the cart store (opened by the header link or the "View cart" toast action).
 * Mounts nothing, and downloads nothing, until the drawer is first opened: the dialog, focus trap, cart lines and
 * totals are a separate chunk. The panel then stays mounted so its close animation and focus return still run.
 */
export function CartDrawer(props: CartDrawerProps) {
  const { open } = useCartStore();
  const [everOpened, setEverOpened] = useState(false);
  if (open && !everOpened) setEverOpened(true);
  return everOpened ? <Panel {...props} /> : null;
}
