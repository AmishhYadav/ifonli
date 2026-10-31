import Link from "next/link";

import { Button, Input, VibeChip } from "@/components/ui";
import { VIBES } from "@/features/vibe/config";

import { VibeCopy } from "./VibeCopy";
import { VibeRestore } from "./VibeRestore";

/** Themed 404 body: the vibe's voice, a search box and a way into every vibe. Server component. */
export function NotFoundView() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-4 py-16 text-center sm:py-24">
      <VibeRestore />
      <p className="font-display text-7xl leading-none display-fx text-accent sm:text-9xl" aria-hidden="true">
        404
      </p>
      <VibeCopy k="notFound.title" as="h1" className="font-display text-4xl leading-tight display-fx sm:text-5xl" />
      <VibeCopy k="notFound.body" as="p" className="text-lg text-ink-muted" />
      <form action="/search" method="get" role="search" className="flex w-full max-w-md items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="not-found-q" className="sr-only">
            Search products
          </label>
          <Input id="not-found-q" name="q" type="search" placeholder="Search the shop..." maxLength={100} />
        </div>
        <Button type="submit" iconStart="search">
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
      <Button asChild variant="secondary">
        <Link href="/">Back to the home page</Link>
      </Button>
    </div>
  );
}
