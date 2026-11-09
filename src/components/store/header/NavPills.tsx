"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import "@/styles/nav-pills.css";

import { cn } from "@/lib/cn";

export interface PillLink {
  href: string;
  label: string;
}

/** The primary navigation, in order. The per-vibe pills are gone: the four vibes are reached from the home page. */
export const NAV_LINKS: readonly PillLink[] = [
  { href: "/home", label: "Home" },
  { href: "/about", label: "About Us" },
  { href: "/types/diy-accessories", label: "DIY" },
  { href: "/policies/returns-refunds", label: "Return Ritual" },
];

/**
 * One pill. The link itself is a 44px-tall transparent target; the visible pill (32px) is the span inside, so hover,
 * focus and the current-page colour are soft shapes while the tap area stays full size. `aria-current` marks the page
 * (styled in styles/nav-pills.css).
 */
function Pill({ link, active }: { link: PillLink; active: boolean }) {
  return (
    <li className="flex-none">
      <Link
        href={link.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "nav-pill group relative inline-flex min-h-11 cursor-pointer items-center rounded-full outline-none",
          // The focus ring is drawn on a pseudo-element the size of the pill (not the 44px target).
          "after:pointer-events-none after:absolute after:inset-x-0 after:inset-y-[6px] after:rounded-full after:content-['']",
          "focus-visible:after:outline-3 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus-ring",
        )}
      >
        <span className="nav-pill-face rounded-full px-4 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors ease-vibe">
          {link.label}
        </span>
      </Link>
    </li>
  );
}

/**
 * `data-more-start` / `data-more-end` on the <nav> say whether the row scrolls on that side (a very narrow phone);
 * nav-pills.css fades that edge in, so a clipped pill reads as "scroll me" rather than as a cut-off label.
 */
function useEdgeFades(nav: React.RefObject<HTMLElement | null>, list: React.RefObject<HTMLUListElement | null>) {
  useEffect(() => {
    const row = list.current;
    const host = nav.current;
    if (!row || !host) return;
    const update = () => {
      const max = row.scrollWidth - row.clientWidth;
      host.toggleAttribute("data-more-start", row.scrollLeft > 4);
      host.toggleAttribute("data-more-end", row.scrollLeft < max - 4);
    };
    update();
    row.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(row);
    return () => {
      row.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [nav, list]);
}

function PillRow({ pathname }: { pathname: string | null }) {
  const nav = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEdgeFades(nav, list);
  return (
    <nav ref={nav} aria-label="Primary" className="nav-pills mx-auto max-w-[1440px]">
      <ul
        ref={list}
        className="flex items-center gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden"
      >
        {NAV_LINKS.map((link) => (
          <Pill key={link.href} link={link} active={pathname === link.href} />
        ))}
      </ul>
    </nav>
  );
}

/** Reads the pathname on the client (the `aria-current` / active colour); the links themselves render on the server. */
function ActivePills() {
  return <PillRow pathname={usePathname()} />;
}

/**
 * Second header row: Home, About Us, DIY and Return Ritual. `usePathname` suspends while the pathname of a
 * not-yet-prerendered route is unknown, so the fallback is the same links without an active pill.
 */
export function NavPills() {
  return (
    <Suspense fallback={<PillRow pathname={null} />}>
      <ActivePills />
    </Suspense>
  );
}
