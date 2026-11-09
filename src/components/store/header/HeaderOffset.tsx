"use client";

import { useEffect, useRef } from "react";

/**
 * Publishes the sticky header's real height as `--header-h` on <html> (store.css turns it into
 * `scroll-padding-top`), so an in-page link lands its target just below the header instead of under it. The
 * header's height changes with the breakpoint, the logo tagline and the font, so it is measured, not guessed.
 * What sticks differs by breakpoint (see Header.tsx): the whole `[data-store-header]` wrapper from `sm` up, only
 * its <header> row on a phone, so the measured element is whichever of the two is sticky right now.
 * Renders nothing; the store.css fallback covers the moment before this runs.
 */
export function HeaderOffset() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const wrapper = marker.current?.closest<HTMLElement>("[data-store-header]");
    const row = wrapper?.querySelector("header");
    if (!wrapper || !row) return;
    const root = document.documentElement;
    const publish = () => {
      const sticky = getComputedStyle(wrapper).position === "sticky" ? wrapper : row;
      root.style.setProperty("--header-h", `${Math.ceil(sticky.getBoundingClientRect().height)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(wrapper);
    observer.observe(row);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--header-h");
    };
  }, []);
  return <span ref={marker} hidden />;
}
