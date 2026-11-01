"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { VibeChip } from "@/components/ui/Chip";
import { VIBES } from "@/features/vibe/config";
import { reportClientError } from "@/lib/monitoring/client";

/**
 * Error boundary body. The wording is neutral on purpose (plan 8.5: error-critical copy is not themed);
 * the vibe shows through the tokens only.
 */
export function ErrorView({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    // A digest means the error happened on the server and onRequestError already reported it.
    if (!error.digest) reportClientError(error, "client-boundary");
  }, [error]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-4 py-16 text-center sm:py-24">
      <h1 className="font-display text-4xl leading-tight display-fx sm:text-5xl">Something went wrong</h1>
      <p className="text-lg text-ink-muted">
        That did not load. Try again, or head somewhere else in the shop.
        {error.digest ? <span className="mt-2 block text-sm">Reference: {error.digest}</span> : null}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={reset} iconStart="refresh">
          Try again
        </Button>
        <Button asChild variant="secondary">
          <Link href="/home">Home</Link>
        </Button>
      </div>
      <form action="/search" method="get" role="search" className="flex w-full max-w-md items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="error-q" className="sr-only">
            Search products
          </label>
          <Input id="error-q" name="q" type="search" placeholder="Search the shop..." maxLength={100} />
        </div>
        <Button type="submit" variant="secondary" iconStart="search">
          Search
        </Button>
      </form>
      <ul className="flex flex-wrap justify-center gap-3" aria-label="Browse by vibe">
        {VIBES.map((v) => (
          <li key={v}>
            <VibeChip vibe={v} href={`/vibes/${v}`} />
          </li>
        ))}
      </ul>
    </div>
  );
}
