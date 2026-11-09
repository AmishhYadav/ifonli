"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { formatINR } from "@/lib/money";

import { SearchTrigger } from "./SearchTrigger";
import { quickSearchAction, type QuickResults } from "./actions";

const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;

export interface SearchShortcut {
  href: string;
  label: string;
}

export interface SearchSheetProps {
  /** Links shown while the box is empty (browse by vibe / type). */
  shortcuts: SearchShortcut[];
  /** Mount already open (the lazy wrapper mounts this on the first click). */
  defaultOpen?: boolean;
}

/**
 * Header search: an icon button opens a modal sheet with a search box and debounced instant results
 * (Server Action). Enter submits the real `GET /search?q=` form, so it also works without JS.
 */
export function SearchSheetPanel({ shortcuts, defaultOpen = false }: SearchSheetProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [value, setValue] = useState("");
  const [answer, setAnswer] = useState<{ key: string; data: QuickResults } | null>(null);

  const q = value.trim();
  const hasQuery = q.length >= MIN_CHARS;

  useEffect(() => {
    if (q.length < MIN_CHARS) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      let data: QuickResults;
      try {
        data = await quickSearchAction(q);
      } catch {
        data = { query: q, products: [], collections: [] };
      }
      if (!cancelled) setAnswer({ key: q, data });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q]);

  // Results belong to the query they were fetched for; anything else is "still searching".
  const results = answer && answer.key === q ? answer.data : null;
  const pending = hasQuery && results === null;
  const hasResults = Boolean(results && (results.products.length > 0 || results.collections.length > 0));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <SearchTrigger />
      </DialogTrigger>
      <DialogContent
        title="Search"
        hideTitle
        className="h-[min(85dvh,34rem)] max-w-xl"
        onOpenAutoFocus={(event) => {
          // Land in the search box rather than on the close button.
          event.preventDefault();
          document.getElementById("header-search")?.focus();
        }}
      >
        <form action="/search" method="get" role="search" className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="header-search" className="sr-only">
              Search products
            </label>
            <Input
              id="header-search"
              name="q"
              type="search"
              autoComplete="off"
              enterKeyHint="search"
              placeholder="Type it. Find it. Love it."
              maxLength={100}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              aria-describedby="header-search-status"
            />
          </div>
          <Button type="submit" size="md" iconStart="search">
            Search
          </Button>
        </form>

        <div id="header-search-status" role="status" aria-live="polite" className="sr-only">
          {pending
            ? "Searching"
            : hasQuery && results
              ? `${results.products.length} quick results`
              : ""}
        </div>

        <div className="mt-4 flex flex-col gap-4">
          {pending ? (
            <p className="flex items-center gap-2 text-sm text-ink-muted" aria-hidden="true">
              <Spinner /> Searching
            </p>
          ) : null}

          {hasQuery && results && hasResults ? (
            <>
              {results.collections.length > 0 ? (
                <ul className="flex flex-wrap gap-2" aria-label="Matching collections">
                  {results.collections.map((c) => (
                    <li key={`${c.kind}-${c.slug}`}>
                      <DialogClose asChild>
                        <Link
                          href={c.kind === "vibe" ? `/vibes/${c.slug}` : `/types/${c.slug}`}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-button bg-surface-2 px-3.5 text-sm font-semibold text-ink"
                        >
                          {c.name}
                          <span className="text-ink-muted">{c.kind === "vibe" ? "vibe" : "type"}</span>
                        </Link>
                      </DialogClose>
                    </li>
                  ))}
                </ul>
              ) : null}
              {results.products.length > 0 ? (
                <ul className="flex flex-col" aria-label="Quick results">
                  {results.products.map((p) => (
                    <li key={p.slug} className="border-b border-hairline last:border-b-0">
                      <DialogClose asChild>
                        <Link
                          href={`/products/${p.slug}`}
                          className="flex min-h-14 items-center gap-3 rounded-input py-2 text-ink hover:bg-surface-2"
                        >
                          <span className="relative size-12 flex-none overflow-hidden rounded-input bg-surface-2">
                            {p.imageSrc ? (
                              <Image
                                src={p.imageSrc}
                                alt=""
                                fill
                                sizes="48px"
                                className="object-contain p-1"
                              />
                            ) : (
                              <Icon name="image" className="absolute inset-0 m-auto size-5 text-ink-muted" />
                            )}
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate font-semibold">{p.name}</span>
                            <span className="truncate text-sm text-ink-muted">{p.typeName}</span>
                          </span>
                          <span className="text-sm font-bold tabular-nums text-price">
                            {formatINR(p.pricePaise)}
                          </span>
                        </Link>
                      </DialogClose>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Link
                href={`/search?q=${encodeURIComponent(q)}`}
                onClick={() => setOpen(false)}
                className="inline-flex min-h-11 items-center gap-1.5 self-start font-semibold text-link underline underline-offset-4"
              >
                See all results for &ldquo;{q}&rdquo;
                <Icon name="arrow-right" className="size-4" />
              </Link>
            </>
          ) : null}

          {hasQuery && results && !hasResults && !pending ? (
            <p className="text-base text-ink-muted">
              Nothing quick for &ldquo;{q}&rdquo;. Press Enter to search the whole shop.
            </p>
          ) : null}

          {!hasQuery ? (
            <section aria-labelledby="header-search-browse">
              <h2 id="header-search-browse" className="mb-2 font-label text-xs tracking-widest text-ink-muted">
                Browse
              </h2>
              <ul className="flex flex-wrap gap-2">
                {shortcuts.map((s) => (
                  <li key={s.href}>
                    <DialogClose asChild>
                      <Link
                        href={s.href}
                        className="inline-flex min-h-11 items-center rounded-button bg-surface-2 px-3.5 text-sm font-semibold text-ink transition-colors ease-vibe hover:bg-[color-mix(in_srgb,var(--accent)_14%,var(--surface-2))]"
                      >
                        {s.label}
                      </Link>
                    </DialogClose>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
