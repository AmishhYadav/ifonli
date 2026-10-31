"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import type { LiveVariantAvailability } from "@/server/services/queries/types";

import { defaultVariantId, findVariant, type PdpModel, type PdpVariant } from "./product-model";

interface PurchaseContextValue {
  model: PdpModel;
  variantId: string | null;
  variant: PdpVariant | null;
  setVariantId: (id: string) => void;
  /** Live availability by variant id; null until the uncached stock hole has streamed in. */
  stock: ReadonlyMap<string, LiveVariantAvailability> | null;
  setStock: (stock: ReadonlyMap<string, LiveVariantAvailability>) => void;
}

const PurchaseContext = createContext<PurchaseContextValue | null>(null);

export function usePurchase(): PurchaseContextValue {
  const ctx = useContext(PurchaseContext);
  if (!ctx) throw new Error("usePurchase must be used inside <PurchaseProvider>");
  return ctx;
}

/**
 * Holds the shopper's variant choice for the whole PDP (gallery, price, options, stock and the add button
 * live in different columns). Renders no DOM of its own, so the page layout (and the sticky mobile bar)
 * are unaffected.
 */
export function PurchaseProvider({ model, children }: { model: PdpModel; children: ReactNode }) {
  const [variantId, setVariantId] = useState<string | null>(() => defaultVariantId(model));
  const [stock, setStock] = useState<ReadonlyMap<string, LiveVariantAvailability> | null>(null);

  const value = useMemo<PurchaseContextValue>(
    () => ({ model, variantId, variant: findVariant(model, variantId), setVariantId, stock, setStock }),
    [model, variantId, stock],
  );
  return <PurchaseContext value={value}>{children}</PurchaseContext>;
}
