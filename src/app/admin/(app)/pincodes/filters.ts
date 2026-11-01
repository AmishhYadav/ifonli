import { SHIPPING_ZONES } from "@/server/services/settings-registry";
import type { PincodeFilters } from "@/server/services/admin/pincodes";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const tri = (v: string | undefined) => (v === "yes" ? true : v === "no" ? false : undefined);

/** Filters from URL search params (shared by the page and the CSV route); bad values are dropped. */
export function pincodeFiltersFromParams(
  params: Record<string, string | string[] | undefined>,
): PincodeFilters & { page: number } {
  const q = one(params.q)?.trim().slice(0, 60);
  const state = one(params.state);
  const zone = one(params.zone);
  return {
    q: q ? q : undefined,
    stateCode: state && /^\d{2}$/.test(state) ? state : undefined,
    zone: zone && (SHIPPING_ZONES as readonly string[]).includes(zone) ? zone : undefined,
    serviceable: tri(one(params.serviceable)),
    cod: tri(one(params.cod)),
    page: Math.max(1, Number.parseInt(one(params.page) ?? "1", 10) || 1),
  };
}

/** Query string for the filters (and optionally a page), omitting empty values. */
export function pincodeQuery(filters: PincodeFilters, page?: number): string {
  const sp = new URLSearchParams();
  if (filters.q) sp.set("q", filters.q);
  if (filters.stateCode) sp.set("state", filters.stateCode);
  if (filters.zone) sp.set("zone", filters.zone);
  if (filters.serviceable !== undefined) sp.set("serviceable", filters.serviceable ? "yes" : "no");
  if (filters.cod !== undefined) sp.set("cod", filters.cod ? "yes" : "no");
  if (page && page > 1) sp.set("page", String(page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
