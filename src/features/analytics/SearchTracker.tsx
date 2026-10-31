"use client";

import { useEffect } from "react";

import { track } from "@/lib/analytics/client";
import { normalizeSearchTerm } from "@/lib/analytics/events";

/**
 * One `search` event per results page: `value` = number of matching products (0 feeds the "searches with
 * no results" insight), `meta.q` = the normalised term (dropped when it looks like personal data).
 * Renders nothing.
 */
export function SearchTracker({ query, results }: { query: string; results: number }) {
  useEffect(() => {
    const q = normalizeSearchTerm(query);
    track("search", { value: results, ...(q ? { meta: { q } } : {}) });
  }, [query, results]);
  return null;
}
