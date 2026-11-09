import type { Metadata } from "next";
import Link from "next/link";

import { VIBE_TAGLINES } from "@/components/store/vibe-taglines";
import { Button } from "@/components/ui/Button";
import { VIBES, VIBE_NAMES } from "@/features/vibe/config";
import { VibeScope } from "@/features/vibe/VibeScope";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "IfOnli makes charms, 3D stickers and DIY kits in four moods: Mochi, Chaos Cabinet, Unapologetic and After the Dark. Made in India.",
  alternates: { canonical: "/about" },
};

/** About IfOnli: what we make and the four moods. Each mood card is its own vibe scope, whatever vibe is worn. */
export default function AboutPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex max-w-2xl flex-col gap-4">
        <p className="text-sm font-bold tracking-widest text-ink-muted uppercase">About us</p>
        <h1 className="font-display text-4xl leading-tight display-fx sm:text-6xl">Tiny things. Big feelings.</h1>
        <p className="text-lg text-ink-muted">
          IfOnli makes charms, 3D stickers and DIY kits for the bags, phones, keys and zips that carry you through the
          day. Everything is made in India, and everything comes in a mood to match yours.
        </p>
      </header>

      <section aria-labelledby="moods" className="mt-12">
        <h2 id="moods" className="font-display text-3xl display-fx sm:text-4xl">
          Four moods, one IfOnli
        </h2>
        <p className="mt-2 max-w-2xl text-base text-ink-muted">
          We don&apos;t believe in one look. Pick the mood that fits today, or collect all four.
        </p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 sm:gap-4">
          {VIBES.map((vibe) => (
            <li key={vibe}>
              <VibeScope
                vibe={vibe}
                as="article"
                className="@container group relative flex h-full flex-col gap-2 rounded-card bg-surface p-6 text-ink shadow-card"
              >
                <h3
                  className={cn(
                    "font-display text-3xl leading-tight display-fx",
                    vibe === "bold" && "title-unapologetic title-unapologetic-sm",
                  )}
                >
                  <Link
                    href={`/vibes/${vibe}`}
                    className="outline-none after:absolute after:inset-0 after:content-['']"
                  >
                    {VIBE_NAMES[vibe]}
                  </Link>
                </h3>
                <p className="text-base text-ink-muted">{VIBE_TAGLINES[vibe]}</p>
              </VibeScope>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="make" className="mt-12 max-w-2xl">
        <h2 id="make" className="font-display text-3xl display-fx sm:text-4xl">
          What we make
        </h2>
        <ul className="mt-4 flex list-disc flex-col gap-2 pl-5 text-base">
          <li>
            <strong>Charms</strong> that clip onto bags, keys, phones and zips.
          </li>
          <li>
            <strong>3D stickers</strong> with a glossy, domed finish.
          </li>
          <li>
            <strong>DIY kits</strong> so you can make your own.
          </li>
        </ul>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg" iconEnd="arrow-right">
            <Link href="/shop">Shop all</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/help">Talk to us</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
