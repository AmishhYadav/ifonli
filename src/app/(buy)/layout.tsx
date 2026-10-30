import Link from "next/link";

import { BuyFooter } from "@/components/store/footer/BuyFooter";
import { Logo } from "@/components/store/header/Logo";
import { Icon } from "@/components/ui";

/**
 * Cart, checkout, confirmation and tracking: palette only (`data-vibe-scope="buy"` resets shape, type and
 * texture to the plain base). Minimal header with no hand button, so nothing distracts from paying.
 */
export default function BuyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-100 rounded-button border-token bg-surface px-4 py-3 font-semibold text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <header className="border-b border-border bg-bg">
        <div className="mx-auto flex min-h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <Logo />
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Icon name="lock" className="size-4" />
            Secure checkout
          </p>
          <Link
            href="/cart"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-link underline underline-offset-4 hover:no-underline"
          >
            <Icon name="arrow-left" className="size-4" />
            Back to cart
          </Link>
        </div>
      </header>
      <main id="main" data-vibe-scope="buy" className="mx-auto min-h-[60dvh] max-w-5xl px-4 py-8 sm:px-6">
        {children}
      </main>
      <BuyFooter />
    </>
  );
}
