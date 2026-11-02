"use client";

import { useEffect, useRef } from "react";

/**
 * Publishes the sticky header's real height as `--header-h` on <html> (store.css turns it into
 * `scroll-padding-top`), so an in-page link lands its target just below the header instead of under it. The
 * header's height changes with the breakpoint, the logo tagline and the font, so it is measured, not guessed.
 * Renders nothing; the store.css fallback covers the moment before this runs.
 */
export function HeaderOffset() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const header = marker.current?.closest("header");
    if (!header) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--header-h", `${Math.ceil(header.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--header-h");
    };
  }, []);
  return <span ref={marker} hidden />;
}
