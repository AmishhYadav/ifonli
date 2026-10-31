import { z } from "zod";

import type { CouponKind, CouponRow } from "@/server/services/admin/discounts";

/**
 * The coupon form works in human units (percent, rupees, local dates in IST) and converts to the
 * service's storage units (basis points, paise, ISO instants) on submit. Pure: client and tests.
 */
export interface CouponFormValues {
  code: string;
  kind: CouponKind;
  /** Percent off, e.g. "10" or "12.5". */
  percent: string;
  /** Rupees off, e.g. "150". */
  amount: string;
  startsAt: string;
  endsAt: string;
  minSubtotal: string;
  maxDiscount: string;
  usageLimit: string;
  perCustomerLimit: string;
  vibes: string[];
  types: string[];
  products: string[];
  excludeProducts: string[];
  active: boolean;
}

export const EMPTY_COUPON_FORM: CouponFormValues = {
  code: "",
  kind: "percent",
  percent: "10",
  amount: "",
  startsAt: "",
  endsAt: "",
  minSubtotal: "",
  maxDiscount: "",
  usageLimit: "",
  perCustomerLimit: "",
  vibes: [],
  types: [],
  products: [],
  excludeProducts: [],
  active: true,
};

const MONEY = /^\d{1,7}(\.\d{1,2})?$/;
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;
const COUNT = /^\d{1,7}$/;

/** "1,299.50" -> 129950 paise; null when blank; NaN when malformed. */
export function rupeesToPaiseOrNull(text: string): number | null {
  const t = text.replace(/[,\s₹]/g, "");
  if (t === "") return null;
  if (!MONEY.test(t)) return Number.NaN;
  const [w, f = ""] = t.split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}

/** "12.5" -> 1250 basis points. */
export function percentToBp(text: string): number {
  const t = text.trim();
  if (!PERCENT.test(t)) return Number.NaN;
  const [w, f = ""] = t.split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}

/** `datetime-local` text (read as IST) -> ISO instant, or null when blank. */
export function istLocalToIso(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const d = new Date(`${t}:00+05:30`);
  return Number.isNaN(d.getTime()) ? "invalid" : d.toISOString();
}

/** Instant -> `datetime-local` text in IST. */
export function isoToIstLocal(d: Date | null): string {
  if (!d) return "";
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16);
}

const formatPaise = (p: number) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));
const formatBp = (bp: number) => (bp % 100 === 0 ? String(bp / 100) : (bp / 100).toFixed(2).replace(/0$/, ""));

export function couponToFormValues(c: CouponRow): CouponFormValues {
  return {
    code: c.code,
    kind: c.kind,
    percent: c.kind === "percent" ? formatBp(c.value) : EMPTY_COUPON_FORM.percent,
    amount: c.kind === "fixed" ? formatPaise(c.value) : "",
    startsAt: isoToIstLocal(c.startsAt),
    endsAt: isoToIstLocal(c.endsAt),
    minSubtotal: c.minSubtotalPaise > 0 ? formatPaise(c.minSubtotalPaise) : "",
    maxDiscount: c.maxDiscountPaise !== null ? formatPaise(c.maxDiscountPaise) : "",
    usageLimit: c.usageLimit !== null ? String(c.usageLimit) : "",
    perCustomerLimit: c.perCustomerLimit !== null ? String(c.perCustomerLimit) : "",
    vibes: c.scope.vibes,
    types: c.scope.types,
    products: c.scope.products,
    excludeProducts: c.scope.excludeProducts,
    active: c.active,
  };
}

/** Client-side validation with the same rules as the service (which stays the authority). */
export const couponFormSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3, "At least 3 characters")
      .max(32, "At most 32 characters")
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Letters, numbers, - and _ only"),
    kind: z.enum(["percent", "fixed", "free_shipping"]),
    percent: z.string(),
    amount: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    minSubtotal: z.string(),
    maxDiscount: z.string(),
    usageLimit: z.string(),
    perCustomerLimit: z.string(),
    vibes: z.array(z.string()),
    types: z.array(z.string()),
    products: z.array(z.string()),
    excludeProducts: z.array(z.string()),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const bad = (path: keyof CouponFormValues, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (v.kind === "percent") {
      const bp = percentToBp(v.percent);
      if (Number.isNaN(bp) || bp < 1 || bp > 10_000) bad("percent", "Enter a percentage between 0.01 and 100");
    }
    if (v.kind === "fixed") {
      const p = rupeesToPaiseOrNull(v.amount);
      if (p === null || Number.isNaN(p) || p < 1) bad("amount", "Enter an amount in rupees above 0");
    }
    const min = rupeesToPaiseOrNull(v.minSubtotal);
    if (Number.isNaN(min)) bad("minSubtotal", "Enter rupees, like 499");
    const max = rupeesToPaiseOrNull(v.maxDiscount);
    if (Number.isNaN(max) || max === 0) bad("maxDiscount", "Enter rupees above 0, or leave blank");
    for (const key of ["usageLimit", "perCustomerLimit"] as const) {
      const t = v[key].trim();
      if (t && (!COUNT.test(t) || Number(t) < 1)) bad(key, "Enter a whole number of 1 or more, or leave blank");
    }
    const s = istLocalToIso(v.startsAt);
    const e = istLocalToIso(v.endsAt);
    if (s === "invalid") bad("startsAt", "Not a valid date and time");
    if (e === "invalid") bad("endsAt", "Not a valid date and time");
    if (s && e && s !== "invalid" && e !== "invalid" && new Date(e) <= new Date(s)) {
      bad("endsAt", "The end must be after the start");
    }
    const u = v.usageLimit.trim();
    const pc = v.perCustomerLimit.trim();
    if (u && pc && Number(pc) > Number(u)) bad("perCustomerLimit", "Per-customer limit can't exceed the total limit");
  });

/** Storage-unit payload for `createCoupon` / `updateCoupon`. Assumes the form validated. */
export function formToInput(v: CouponFormValues): Record<string, unknown> {
  const num = (t: string) => (t.trim() ? Number(t.trim()) : null);
  const iso = (t: string) => {
    const r = istLocalToIso(t);
    return r === "invalid" ? null : r;
  };
  return {
    code: v.code,
    kind: v.kind,
    value: v.kind === "percent" ? percentToBp(v.percent) : v.kind === "fixed" ? (rupeesToPaiseOrNull(v.amount) ?? 0) : 0,
    startsAt: iso(v.startsAt),
    endsAt: iso(v.endsAt),
    minSubtotalPaise: rupeesToPaiseOrNull(v.minSubtotal) ?? 0,
    maxDiscountPaise: v.kind === "free_shipping" ? null : rupeesToPaiseOrNull(v.maxDiscount),
    usageLimit: num(v.usageLimit),
    perCustomerLimit: num(v.perCustomerLimit),
    scope: { vibes: v.vibes, types: v.types, products: v.products, excludeProducts: v.excludeProducts },
    active: v.active,
  };
}

/** Where a service validation path shows up in the form. */
export function serviceFieldToForm(path: string, kind: CouponKind): keyof CouponFormValues | "form" {
  if (path === "value") return kind === "percent" ? "percent" : "amount";
  if (path === "minSubtotalPaise") return "minSubtotal";
  if (path === "maxDiscountPaise") return "maxDiscount";
  if (path.startsWith("scope.")) return (path.split(".")[1] ?? "form") as keyof CouponFormValues;
  if (["code", "startsAt", "endsAt", "usageLimit", "perCustomerLimit"].includes(path)) return path as keyof CouponFormValues;
  return "form";
}
