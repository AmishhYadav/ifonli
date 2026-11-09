import { HandButton } from "@/features/vibe/HandButton";
import { SearchSheet, type SearchShortcut } from "@/features/search/SearchSheet";
import { isVibe } from "@/features/vibe/config";
import { getCollections } from "@/server/cache/catalog";
import { getVibeSettings } from "@/server/cache/settings";

import { CartButton } from "./CartButton";
import { HeaderOffset } from "./HeaderOffset";
import { IconLink } from "./IconLink";
import { Logo } from "./Logo";
import { MobileMenuLazy } from "./MobileMenuLazy";
import { NavPills } from "./NavPills";

/**
 * Storefront header. From `sm` up the whole header is sticky and soft (translucent, a hairline underline, no hard
 * edge). On a phone only row 1 sticks (the wrapper is `display: contents`, so its sticky box is the page): the
 * pill row scrolls away with the page, which frees ~44px of every screen, and the bar is near-opaque there because
 * a backdrop blur costs a phone a repaint of everything under it on every scroll frame. Row 1: the hand
 * button (with its "Turn Me" label) and the wordmark on the left; search, account, wishlist and bag on the right
 * (on a phone: search, bag, menu). Row 2: Home, About Us, DIY and Return Ritual, the current page filled in.
 */
export async function Header() {
  const [{ cycle }, collections] = await Promise.all([getVibeSettings(), getCollections()]);
  const vibes = collections.vibes.filter((v) => isVibe(v.slug));
  const types = collections.types;

  const shortcuts: SearchShortcut[] = [
    { href: "/shop", label: "Shop all" },
    ...vibes.map((v) => ({ href: `/vibes/${v.slug}`, label: v.name })),
    ...types.map((t) => ({ href: `/types/${t.slug}`, label: t.name })),
  ];

  return (
    <div
      data-store-header=""
      className="contents sm:sticky sm:top-0 sm:z-40 sm:block sm:border-b sm:border-hairline sm:bg-bg/85 sm:backdrop-blur"
    >
      <HeaderOffset />
      <header className="sticky top-0 z-40 border-b border-hairline bg-bg sm:static sm:border-b-0 sm:bg-transparent">
        <div className="mx-auto flex max-w-[1440px] items-center gap-2 px-4 pt-2 pb-1.5 max-[359px]:gap-1 max-[359px]:pr-3 sm:gap-3 sm:px-6 sm:pb-0">
          {/* Never squeezed (its "Turn Me" label would hang past the screen edge): on a 320px phone the hand and the wordmark are a little smaller instead (motion.css, Logo.tsx). */}
          <HandButton cycle={cycle} className="header-hand shrink-0" />
          <Logo tagline className="ml-1 max-[359px]:ml-0" />

          <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
            <SearchSheet shortcuts={shortcuts} />
            <IconLink href="/account" icon="user" label="Account" className="hidden md:inline-flex" />
            <IconLink href="/wishlist" icon="heart" label="Wishlist" flyTarget="wishlist" className="hidden md:inline-flex" />
            <CartButton className="size-11 min-h-11 min-w-11 rounded-full px-0 [&_svg]:size-7" />
            <MobileMenuLazy className="md:hidden [&_svg]:size-7" />
          </div>
        </div>
      </header>

      <NavPills />
    </div>
  );
}
