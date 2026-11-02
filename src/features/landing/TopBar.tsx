import Link from "next/link";

/**
 * Fixed top bar: the wordmark (to the store) and an always-visible "Skip intro". Both are plain links to
 * /home; they do not prefetch on load (the motion code prefetches when the portal approaches or on intent).
 */
export function TopBar() {
  return (
    <header className="l-top">
      <Link href="/home" prefetch={false} className="l-pill l-top__logo" aria-label="IfOnli, go to the store">
        If<span>Onli</span>
      </Link>
      <Link href="/home" prefetch={false} className="l-pill l-top__skip" data-prefetch-intent>
        Skip intro
      </Link>
    </header>
  );
}
