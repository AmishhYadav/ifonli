"use client";

import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { findScope, sameScope, type ScopeAttrs } from "./scope";

const ScopeContext = createContext<ScopeAttrs>({});

/** Attributes the portalled content of the enclosing overlay should carry. */
export function useOverlayScope(): ScopeAttrs {
  return useContext(ScopeContext);
}

/**
 * Renders a hidden marker where the overlay root lives, finds the vibe/buy scope around it, and provides
 * it to the portalled content through context.
 */
export function ScopeProvider({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [scope, setScope] = useState<ScopeAttrs>({});

  useLayoutEffect(() => {
    const next = findScope(ref.current);
    setScope((prev) => (sameScope(prev, next) ? prev : next));
  }, []);

  return (
    <ScopeContext value={scope}>
      <span ref={ref} hidden data-scope-sentinel="" />
      {children}
    </ScopeContext>
  );
}
