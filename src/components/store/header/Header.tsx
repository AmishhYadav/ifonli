import { HandButton } from "@/features/vibe/HandButton";
import { SearchSheet, type SearchShortcut } from "@/features/search/SearchSheet";
import { isVibe, type Vibe } from "@/features/vibe/config";
import { getCollections } from "@/server/cache/catalog";
import { getVibeSettings } from "@/server/cache/settings";

import { CartButton } from "./CartButton";
import { IconLink } from "./IconLink";
import { Logo } from "./Logo";
import type { MenuLink } from "./MobileMenu";
import { MobileMenuLazy } from "./MobileMenuLazy";
import { NavPills } from "./NavPills";

/**
 * Storefront header, sticky and soft (translucent, a hairline underline, no hard edge). Row 1: the hand
 * button and the wordmark on the left; search, account, wishlist and bag on the right (on a phone: search,
 * bag, menu). Row 2: pills for the four vibes, the types and Shop all, with the current theme filled in (strong) and the current page tinted (soft).
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
    <header className="sticky top-0 z-40 border-b border-hairline bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1440px] items-center gap-2 px-4 pt-2 sm:gap-3 sm:px-6">
        <HandButton cycle={cycle} className="header-hand" />
        <Logo tagline className="ml-1" />

        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          <SearchSheet shortcuts={shortcuts} />
          <IconLink href="/account" icon="user" label="Account" className="hidden md:inline-flex" />
          <IconLink href="/wishlist" icon="heart" label="Wishlist" flyTarget="wishlist" className="hidden md:inline-flex" />
          <CartButton className="size-11 min-h-11 min-w-11 rounded-full px-0 [&_svg]:size-7" />
          <MobileMenuLazy vibes={vibeLinks} types={typeLinks} className="md:hidden [&_svg]:size-7" />
        </div>
      </div>

      <NavPills
        vibes={vibes.map((v) => ({ href: `/vibes/${v.slug}`, label: v.name, vibe: v.slug as Vibe }))}
        types={typeLinks.map(({ href, label }) => ({ href, label }))}
        shop={{ href: "/shop", label: "Shop all" }}
      />
    </header>
  );
}
