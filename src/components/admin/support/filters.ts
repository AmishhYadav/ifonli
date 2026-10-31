export interface FilterValues {
  status: string;
  type: string;
  assigned: string;
  q: string;
}

/** The status shown when the URL has none: what still needs the team. */
export const DEFAULT_STATUS = "active";

/** `/admin/support?tab=…&status=…` for the given filters; defaults are left out of the URL. */
export function supportHref(tab: "inbox" | "cases", v: FilterValues, page = 1): string {
  const sp = new URLSearchParams();
  if (tab === "cases") sp.set("tab", "cases");
  if (v.status && v.status !== DEFAULT_STATUS) sp.set("status", v.status);
  if (v.type) sp.set("type", v.type);
  if (v.assigned) sp.set("assigned", v.assigned);
  if (v.q.trim()) sp.set("q", v.q.trim());
  if (page > 1) sp.set("page", String(page));
  return `/admin/support${sp.size ? `?${sp}` : ""}`;
}
