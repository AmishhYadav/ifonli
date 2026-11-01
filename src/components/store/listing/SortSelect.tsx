"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useTransition } from "react";

import { Select } from "@/components/ui/Field";

import { SORT_LABELS, type SearchSortValue } from "./params";

interface SortSelectProps {
  value: SearchSortValue;
  /** Sort value -> canonical href with that sort (other filters kept). Computed on the server. */
  hrefs: Partial<Record<SearchSortValue, string>>;
}

/** Native select that navigates on change; the `noscript` list keeps sorting available without JS. */
export function SortSelect({ value, hrefs }: SortSelectProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const id = useId();
  const options = Object.keys(hrefs) as SearchSortValue[];
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm font-semibold whitespace-nowrap">
        Sort by
      </label>
      <Select
        id={id}
        value={value}
        wrapperClassName="min-w-44"
        onChange={(event) => {
          const href = hrefs[event.target.value as SearchSortValue];
          if (href) startTransition(() => router.replace(href, { scroll: false }));
        }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {SORT_LABELS[option]}
          </option>
        ))}
      </Select>
      <noscript>
        <ul className="flex gap-2 text-sm">
          {options.map((option) => (
            <li key={option}>
              <Link href={hrefs[option]!}>{SORT_LABELS[option]}</Link>
            </li>
          ))}
        </ul>
      </noscript>
    </div>
  );
}
