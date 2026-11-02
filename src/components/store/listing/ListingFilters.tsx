"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Field";
import { Switch } from "@/components/ui/Switch";
import { VibeDot } from "@/components/ui/Chip";
import { VIBE_NAMES, isVibe } from "@/features/vibe/config";
import { formatINR } from "@/lib/money";

import {
  buildListingHref,
  defaultSort,
  type FixedFilters,
  type ListingQuery,
  type SearchSortValue,
} from "./params";

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface ListingFacets {
  vibes: FacetOption[];
  types: FacetOption[];
  madeIn: FacetOption[];
  /** Paise. */
  priceRange: { min: number; max: number };
}

interface ListingFiltersProps {
  basePath: string;
  /** Search term, kept across filter changes. */
  q?: string;
  search?: boolean;
  fixed?: FixedFilters;
  query: ListingQuery;
  facets: ListingFacets;
  /** Render an explicit submit button (always for the drawer; desktop shows it only without JS). */
  submitLabel?: string;
  alwaysShowSubmit?: boolean;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1 border-0 p-0">
      <legend className="mb-1 font-label text-sm">{title}</legend>
      {children}
    </fieldset>
  );
}

/**
 * Filter form. It is a real `GET` form (works without JS, shareable URLs); with JS every change navigates
 * with `router.replace` (no page jump), and price applies on blur or Enter. The page param is dropped on
 * any change so results restart at page 1.
 */
export function ListingFilters({
  basePath,
  q,
  search,
  fixed = {},
  query,
  facets,
  submitLabel = "Apply filters",
  alwaysShowSubmit = false,
}: ListingFiltersProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const uid = useId();

  const currentHref = buildListingHref(basePath, query, { search, q });

  // The inputs are uncontrolled, so a ticked box stays ticked when the URL changes underneath it. For a
  // change this form did not ask for (a removed chip, "Clear all", back/forward) the form is remounted
  // with the URL's values; otherwise the sidebar keeps showing filters the results no longer use and the
  // next toggle re-adds them. Changes the form asked for itself keep the form (and focus) as they are.
  // (`form.reset()` would not do: React's value tracking then swallows the next click on a box.)
  const [sync, setSync] = useState({ href: currentHref, expected: currentHref, generation: 0 });
  if (sync.href !== currentHref) {
    setSync({
      href: currentHref,
      expected: currentHref,
      generation: currentHref === sync.expected ? sync.generation : sync.generation + 1,
    });
  }

  const navigate = () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const list = (name: string) => data.getAll(name).map(String);
    const priceValue = (name: string) => {
      const text = String(data.get(name) ?? "").trim();
      return /^\d{1,7}$/.test(text) ? Number(text) : null;
    };
    let minRupees = priceValue("min");
    let maxRupees = priceValue("max");
    if (minRupees !== null && maxRupees !== null && minRupees > maxRupees) {
      [minRupees, maxRupees] = [maxRupees, minRupees];
    }
    const sortValue = String(data.get("sort") ?? "") as SearchSortValue;
    const href = buildListingHref(
      basePath,
      {
        vibes: list("vibes"),
        types: list("types"),
        minRupees,
        maxRupees,
        inStock: data.get("stock") === "1",
        madeIn: list("made"),
        sort: sortValue || defaultSort(search),
      },
      { search, q },
    );
    if (href === currentHref) return;
    setSync((prev) => ({ ...prev, expected: href }));
    startTransition(() => router.replace(href, { scroll: false }));
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate();
  };

  const priceHint = facets.priceRange.max > 0 ? `${formatINR(facets.priceRange.min)} to ${formatINR(facets.priceRange.max)}` : null;

  return (
    <form
      key={sync.generation}
      ref={formRef}
      method="get"
      action={basePath}
      onSubmit={onSubmit}
      onChange={(event) => {
        // Number inputs apply on blur/Enter; everything else applies immediately.
        if ((event.target as { type?: string }).type !== "number") navigate();
      }}
      aria-busy={pending}
      aria-label="Filters"
      className="flex flex-col gap-6"
      data-testid="listing-filters"
    >
      {q ? <input type="hidden" name="q" value={q} /> : null}
      <input type="hidden" name="sort" value={query.sort} />

      {!fixed.vibe && facets.vibes.length > 0 ? (
        <Group title="Vibe">
          {facets.vibes.map((o) => (
            <Checkbox
              key={o.value}
              name="vibes"
              value={o.value}
              defaultChecked={query.vibes.includes(o.value)}
              label={
                <span className="inline-flex items-center gap-2">
                  {isVibe(o.value) ? <VibeDot vibe={o.value} /> : null}
                  {isVibe(o.value) ? VIBE_NAMES[o.value] : o.label}
                  <span className="font-normal text-ink-muted">({o.count})</span>
                </span>
              }
            />
          ))}
        </Group>
      ) : null}

      {!fixed.type && facets.types.length > 0 ? (
        <Group title="Type">
          {facets.types.map((o) => (
            <Checkbox
              key={o.value}
              name="types"
              value={o.value}
              defaultChecked={query.types.includes(o.value)}
              label={
                <span>
                  {o.label} <span className="font-normal text-ink-muted">({o.count})</span>
                </span>
              }
            />
          ))}
        </Group>
      ) : null}

      <Group title="Price (₹)">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-min`} className="text-sm font-semibold">
              Min
            </label>
            <Input
              id={`${uid}-min`}
              name="min"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder={facets.priceRange.max > 0 ? String(Math.floor(facets.priceRange.min / 100)) : "0"}
              defaultValue={query.minRupees ?? ""}
              onBlur={navigate}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-max`} className="text-sm font-semibold">
              Max
            </label>
            <Input
              id={`${uid}-max`}
              name="max"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder={facets.priceRange.max > 0 ? String(Math.ceil(facets.priceRange.max / 100)) : ""}
              defaultValue={query.maxRupees ?? ""}
              onBlur={navigate}
            />
          </div>
        </div>
        {priceHint ? <p className="text-sm text-ink-muted">Range here: {priceHint}</p> : null}
      </Group>

      <Group title="Availability">
        <Switch name="stock" value="1" label="In stock only" defaultChecked={query.inStock} />
      </Group>

      {facets.madeIn.length > 1 || query.madeIn.length > 0 ? (
        <Group title="Made in">
          {facets.madeIn.map((o) => (
            <Checkbox
              key={o.value}
              name="made"
              value={o.value}
              defaultChecked={query.madeIn.includes(o.value)}
              label={
                <span>
                  {o.label} <span className="font-normal text-ink-muted">({o.count})</span>
                </span>
              }
            />
          ))}
        </Group>
      ) : null}

      {alwaysShowSubmit ? (
        <Button type="submit" fullWidth>
          {submitLabel}
        </Button>
      ) : (
        <noscript>
          <Button type="submit" fullWidth>
            {submitLabel}
          </Button>
        </noscript>
      )}
    </form>
  );
}
