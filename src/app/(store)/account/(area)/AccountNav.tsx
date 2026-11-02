"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { endAccountWishlist } from "@/features/wishlist/account-sync";

import { signOutAction } from "./actions";

const LINKS = [
  { href: "/account", label: "Overview", exact: true },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/addresses", label: "Addresses" },
  { href: "/account/profile", label: "Profile and privacy" },
  { href: "/wishlist", label: "Wishlist" },
] as const;

/** Section links with `aria-current`, plus sign out. Links are >= 44px tall and wrap on narrow screens. */
export function AccountNav() {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [signingOut, setSigningOut] = useState(false);

  function signOut() {
    setSigningOut(true);
    // Stop syncing and clear this device's copy first: the next person on this device starts clean.
    endAccountWishlist();
    startTransition(async () => {
      await signOutAction();
    });
  }

  return (
    <nav aria-label="Account" className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-hairline pb-3">
      {LINKS.map((link) => {
        const active = "exact" in link ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-button px-3 text-base font-semibold text-ink hover:bg-surface-2",
              active && "bg-surface-2 underline decoration-2 underline-offset-8",
            )}
          >
            {link.label}
          </Link>
        );
      })}
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        iconStart="lock"
        loading={pending || signingOut}
        onClick={signOut}
        data-testid="sign-out"
      >
        Sign out
      </Button>
    </nav>
  );
}
