"use client";

/**
 * Overlays (dialog, drawer, tooltip, toast) are portalled to <body>, which would drop them out of the
 * `[data-vibe]` / `[data-vibe-scope]` ancestor that opened them (a Buy page's dialog would turn expressive).
 * These helpers read the scope attributes of the originating element so the portalled content can wear them.
 */

export interface ScopeAttrs {
  "data-vibe"?: string;
  "data-vibe-scope"?: string;
}

/** The nearest vibe scope (not <html>) and nearest buy-style scope of an element. */
export function findScope(el: Element | null | undefined): ScopeAttrs {
  const out: ScopeAttrs = {};
  if (!el) return out;
  const vibe = el.closest<HTMLElement>("[data-vibe]:not(html)")?.dataset.vibe;
  const scope = el.closest<HTMLElement>("[data-vibe-scope]")?.dataset.vibeScope;
  if (vibe) out["data-vibe"] = vibe;
  if (scope) out["data-vibe-scope"] = scope;
  return out;
}

export function sameScope(a: ScopeAttrs, b: ScopeAttrs): boolean {
  return a["data-vibe"] === b["data-vibe"] && a["data-vibe-scope"] === b["data-vibe-scope"];
}
