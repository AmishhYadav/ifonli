"use client";

import { useEffect, useState } from "react";

import { PALETTE_KEYS, SHAPE_KEYS } from "@/features/vibe/tokens";
import { useVibe } from "@/features/vibe/useVibe";

type Values = Record<string, string>;

const NON_COLOUR = new Set(["texture-opacity"]);

/** Live token values for the active vibe, read from the computed style of <html>. */
export function TokenTable() {
  const { vibe } = useVibe();
  const [values, setValues] = useState<Values>({});

  useEffect(() => {
    // Read after the new vibe's styles have been applied; setState happens in a callback, not the effect body.
    const frame = requestAnimationFrame(() => {
      const style = getComputedStyle(document.documentElement);
      const read: Values = {};
      for (const key of [...PALETTE_KEYS, ...SHAPE_KEYS]) {
        read[key] = style.getPropertyValue(`--${key}`).trim();
      }
      setValues(read);
    });
    return () => cancelAnimationFrame(frame);
  }, [vibe]);

  return (
    <div className="grid gap-6 lg:grid-cols-2" data-testid="token-table">
      <div className="min-w-0">
        <h3 className="mb-3 font-display text-xl">Palette ({vibe})</h3>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
          {PALETTE_KEYS.map((key) => (
            <li
              key={key}
              className="flex items-center gap-2 rounded-md border border-border bg-surface p-2 text-xs"
            >
              {NON_COLOUR.has(key) ? null : (
                <span
                  aria-hidden="true"
                  className="h-8 w-8 flex-none rounded border border-border"
                  style={{ background: `var(--${key})` }}
                />
              )}
              <span className="min-w-0">
                <span className="block truncate font-semibold">{key}</span>
                <span className="block truncate text-ink-muted">{values[key] ?? ""}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0">
        <h3 className="mb-3 font-display text-xl">Shape, type, texture</h3>
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1 text-xs">
          {SHAPE_KEYS.map((key) => (
            <li key={key} className="flex justify-between gap-3 border-b border-border py-1">
              <span className="font-semibold">{key}</span>
              <span className="min-w-0 truncate text-right text-ink-muted">
                {values[key] ?? ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
