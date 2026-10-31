"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

export interface AccountNavItem {
  href: string;
  label: string;
}

export const ACCOUNT_NAV: readonly AccountNavItem[] = [
  { href: "/account", label: "Overview" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/addresses", label: "Addresses" },
  { href: "/account/profile", label: "Profile" },
  { href: "/wishlist", label: "Wishlist" },
  { href: "/account/privacy", label: "Privacy and data" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/account") return pathname === "/account";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Side list on wide screens, a wrapping row of pills on phones. */
export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Your account">
      <ul className="flex flex-wrap gap-2 md:flex-col md:gap-1">
        {ACCOUNT_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 w-full items-center rounded-button px-4 text-base font-semibold",
                  active
                    ? "border-token bg-accent text-on-accent"
                    : "border border-transparent text-ink hover:bg-surface-2",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
