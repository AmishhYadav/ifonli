"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { cn } from "@/lib/cn";

export interface PillLink {
  href: string;
  label: string;
}

interface NavPillsProps {
  vibes: PillLink[];
  types: PillLink[];
  shop: PillLink;
}

/**
 * One pill. The link itself is a 44px-tall transparent target; the visible pill (32px) is the span inside, so
 * hover, focus and the active colour are soft shapes while the tap area stays full size.
 */
function Pill({ link, active, spaced }: { link: PillLink; active: boolean; spaced?: boolean }) {
  return (
    <li className={cn("flex-none", spaced && "ml-3 sm:ml-4")}>
      <Link
        href={link.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative inline-flex min-h-11 items-center rounded-full outline-none",
          // The focus ring is drawn on a pseudo-element the size of the pill (not the 44px target).
          "after:pointer-events-none after:absolute after:inset-x-0 after:inset-y-[6px] after:rounded-full after:content-['']",
          "focus-visible:after:outline-3 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus-ring",
        )}
      >
        <span
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors ease-vibe",
            active ? "bg-accent text-on-accent" : "text-ink group-hover:bg-surface-2",
          )}
        >
          {link.label}
        </span>
      </Link>
    </li>
  );
}

function PillRow({ vibes, types, shop, pathname }: NavPillsProps & { pathname: string | null }) {
  const isActive = (href: string) => pathname === href;
  return (
    <nav aria-label="Primary" className="mx-auto max-w-[1440px]">
      <ul className="flex items-center gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden">
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
