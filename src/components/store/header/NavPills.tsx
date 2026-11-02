"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import "@/styles/nav-pills.css";

import type { Vibe } from "@/features/vibe/config";
import { switchTheme, warmVibeFont } from "@/features/vibe/switch";
import { useVibe } from "@/features/vibe/useVibe";
import { cn } from "@/lib/cn";

export interface PillLink {
  href: string;
  label: string;
  /** Set on the four theme pills: the vibe this pill switches the theme to (it is a button, not a link). */
  vibe?: Vibe;
}

interface NavPillsProps {
  vibes: PillLink[];
  types: PillLink[];
  shop: PillLink;
}

/**
 * One pill. The link (or, for a theme, the button) itself is a 44px-tall transparent target; the visible pill
 * (32px) is the span inside, so hover, focus and the active colours are soft shapes while the tap area stays full size. The strong "this is
 * the current theme" colour and the soft "this is the current page" tint are both CSS (styles/nav-pills.css):
 * `data-nav-vibe` is matched against `html[data-vibe]`, `aria-current` marks the page. The four theme pills are
 * buttons that switch the theme in place (`aria-pressed` = the worn theme); only on a theme's own page do they
 * also move to `/vibes/<new>` (see `switchTheme`). Types and Shop all are plain links.
 */
function Pill({ link, active, spaced }: { link: PillLink; active: boolean; spaced?: boolean }) {
  const className = cn(
    "nav-pill group relative inline-flex min-h-11 cursor-pointer items-center rounded-full outline-none",
    // The focus ring is drawn on a pseudo-element the size of the pill (not the 44px target).
    "after:pointer-events-none after:absolute after:inset-x-0 after:inset-y-[6px] after:rounded-full after:content-['']",
    "focus-visible:after:outline-3 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus-ring",
  );
  const face = (
    <span className="nav-pill-face rounded-full px-4 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors ease-vibe">
      {link.label}
    </span>
  );
  return (
    <li className={cn("flex-none", spaced && "ml-3 sm:ml-4")}>
      {link.vibe ? (
        <ThemeButton vibe={link.vibe} current={active} className={className}>
          {face}
        </ThemeButton>
      ) : (
        <Link href={link.href} aria-current={active ? "page" : undefined} className={className}>
          {face}
        </Link>
      )}
    </li>
  );
}

/**
 * A theme pill: a real button that wears the theme without leaving the page. `aria-pressed` reads `useVibe`, whose
 * server snapshot is the default vibe, so hydration matches and the real theme (set before paint by the head
 * script) lands on the first client render; the strong colour itself is CSS and is right from the first paint.
 */
function ThemeButton({
  vibe,
  current,
  className,
  children,
}: {
  vibe: Vibe;
  /** The visitor is on this theme's own `/vibes/<slug>` page (soft tint). */
  current: boolean;
  className: string;
  children: React.ReactNode;
}) {
  const { vibe: worn } = useVibe();
  const router = useRouter();
  const warm = () => warmVibeFont(vibe);
  return (
    <button
      type="button"
      data-nav-vibe={vibe}
      aria-pressed={worn === vibe}
      aria-current={current ? "page" : undefined}
      className={className}
      onClick={() => void switchTheme(vibe, "nav", router)}
      onPointerEnter={warm}
      onFocus={warm}
    >
      {children}
    </button>
  );
}

/**
 * Phone behaviour of the pill row. (1) The current theme's pill is scrolled to the middle of the row on load
 * (instantly) and whenever the vibe changes (smoothly, unless the visitor prefers reduced motion). Only the row's
 * own scrollLeft moves, never the page (no scrollIntoView). (2) `data-more-start` / `data-more-end` on the <nav>
 * say whether there is more to scroll to on that side; nav-pills.css fades that edge in, so a clipped pill reads
 * as "scroll me" rather than as a cut-off label.
 */
function usePillRowScroll(nav: React.RefObject<HTMLElement | null>, list: React.RefObject<HTMLUListElement | null>) {
  const { vibe } = useVibe();
  const loaded = useRef(false);

  useEffect(() => {
    const row = list.current;
    const pill = row?.querySelector<HTMLElement>(`[data-nav-vibe="${vibe}"]`);
    if (!row || !pill) return;
    const rowBox = row.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    const left = row.scrollLeft + (pillBox.left - rowBox.left) - (rowBox.width - pillBox.width) / 2;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollTo({ left: Math.max(0, left), behavior: loaded.current && !reduced ? "smooth" : "instant" });
    loaded.current = true;
  }, [vibe, list]);

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

function PillRow({ vibes, types, shop, pathname }: NavPillsProps & { pathname: string | null }) {
  const isActive = (href: string) => pathname === href;
  const nav = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);
  usePillRowScroll(nav, list);
  return (
    <nav ref={nav} aria-label="Primary" className="nav-pills mx-auto max-w-[1440px]">
      <ul
        ref={list}
        className="flex items-center gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden"
      >
        {vibes.map((link) => (
          <Pill key={link.href} link={link} active={isActive(link.href)} />
        ))}
        {types.map((link, i) => (
          <Pill key={link.href} link={link} active={isActive(link.href)} spaced={i === 0} />
        ))}
        <Pill link={shop} active={isActive(shop.href)} />
      </ul>
    </nav>
  );
}

/** Reads the pathname on the client (the `aria-current` / active colour); the links themselves render on the server. */
function ActivePills(props: NavPillsProps) {
  const pathname = usePathname();
  return <PillRow {...props} pathname={pathname} />;
}

/**
 * Second header row: the four vibes (in the order the shop sets), the product types, then Shop all. Scrolls
 * sideways on a phone. `usePathname` suspends while the pathname of a not-yet-prerendered route is unknown, so
 * the fallback is the same links without an active pill.
 */
export function NavPills(props: NavPillsProps) {
  return (
    <Suspense fallback={<PillRow {...props} pathname={null} />}>
      <ActivePills {...props} />
    </Suspense>
  );
}
