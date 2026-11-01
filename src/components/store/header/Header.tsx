import Link from "next/link";

import { HandButton } from "@/features/vibe/HandButton";
import { SearchSheet, type SearchShortcut } from "@/features/search/SearchSheet";
import { isVibe } from "@/features/vibe/config";
import { getCollections } from "@/server/cache/catalog";
import { getVibeSettings } from "@/server/cache/settings";

import { CartButton } from "./CartButton";
import { IconLink } from "./IconLink";
import { Logo } from "./Logo";
import type { MenuLink } from "./MobileMenu";
import { MobileMenuLazy } from "./MobileMenuLazy";
import { NavMenu } from "./NavMenu";
import { VibeSwatchLink } from "./VibeSwatchLink";

const navLinkClass =
  "inline-flex min-h-11 items-center rounded-button px-3 text-base font-semibold text-ink hover:bg-surface-2";

/**
 * Storefront header. Top-left on every breakpoint: the hand button. Below `lg` the nav collapses into the
 * right-hand drawer: `[hand] [logo] ... [search] [cart] [menu]`.
 */
export async function Header() {
  const [{ cycle }, collections] = await Promise.all([getVibeSettings(), getCollections()]);
  const vibes = collections.vibes.filter((v) => isVibe(v.slug));
  const types = collections.types;

  const vibeLinks: MenuLink[] = vibes.map((v) => ({
    href: `/vibes/${v.slug}`,
    label: v.name,
    vibe: v.slug,
  }));
  const typeLinks: MenuLink[] = types.map((t) => ({
    href: `/types/${t.slug}`,
    label: t.name,
    detail: String(t.productCount),
  }));
  const shortcuts: SearchShortcut[] = [
    { href: "/shop", label: "Shop all" },
    ...vibes.map((v) => ({ href: `/vibes/${v.slug}`, label: v.name })),
    ...types.map((t) => ({ href: `/types/${t.slug}`, label: t.name })),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/95">
      <div className="mx-auto flex min-h-16 max-w-[1440px] items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <HandButton cycle={cycle} className="header-hand" />
        <Logo className="ml-1" />

        <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 lg:flex">
          <Link href="/shop" className={navLinkClass}>
            Shop
          </Link>
          <NavMenu label="Vibes" panelClassName="w-[min(30rem,90vw)]">
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {vibeLinks.map((link) => (
                <li key={link.href}>
                  <VibeSwatchLink href={link.href} vibe={link.vibe!} label={link.label} />
                </li>
              ))}
              <li>
                <Link
                  href="/shop"
                  className="flex min-h-14 items-center justify-center rounded-card border-token border-dashed px-3 text-base font-semibold text-ink hover:bg-surface-2"
                >
                  All vibes together
                </Link>
              </li>
            </ul>
          </NavMenu>
          <NavMenu label="Types" panelClassName="w-72">
            <ul className="flex flex-col">
              {typeLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-input px-3 text-base font-semibold text-ink hover:bg-surface-2"
                  >
                    {link.label}
                    <span className="text-sm font-normal text-ink-muted">{link.detail}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </NavMenu>
        </nav>

        <div className="ml-auto flex items-center">
          <SearchSheet shortcuts={shortcuts} />
          <IconLink href="/account" icon="user" label="Account" className="hidden md:inline-flex" />
          <IconLink href="/wishlist" icon="heart" label="Wishlist" className="hidden md:inline-flex" />
          <CartButton />
          <MobileMenuLazy vibes={vibeLinks} types={typeLinks} className="lg:hidden" />
        </div>
      </div>
    </header>
  );
}
