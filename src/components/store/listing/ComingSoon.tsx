import Link from "next/link";

import { Button } from "@/components/ui/Button";

/** Type collections that are announced before they have a single product: they show "Coming soon" instead of an empty listing. */
export const COMING_SOON_TYPES: readonly string[] = ["3d-stickers"];

/**
 * A collection with nothing in it yet, said warmly: a big "Coming soon" and a way back to the shop. The page's h1
 * is already the collection name, so this is the section heading under it.
 */
export function ComingSoon() {
  return (
    <div
      data-testid="coming-soon"
      className="@container mx-auto flex max-w-3xl flex-col items-center gap-4 rounded-card bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] px-6 py-16 text-center text-ink sm:py-24"
    >
      <h2 className="font-display text-[min(5rem,16cqi)] leading-[1.05] display-fx">
        <span className="block">COMING</span> <span className="block">SOON</span>
      </h2>
      <p className="text-xl text-ink-muted">It&apos;s worth the wait.</p>
      <Button asChild variant="secondary" className="mt-4">
        <Link href="/shop">Browse everything</Link>
      </Button>
    </div>
  );
}
