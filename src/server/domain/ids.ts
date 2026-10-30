/** Order references and invoice numbers. All calendar logic is Asia/Kolkata (IST). */

import { randomInt } from "node:crypto";

import { istParts } from "./ist";

/** Crockford base32 without the ambiguous I, L, O, U. */
export const ORDER_REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Returns an integer in [0, maxExclusive). Injectable for deterministic tests. */
export type RandomIntFn = (maxExclusive: number) => number;

const defaultRandomInt: RandomIntFn = (max) => randomInt(max);

/** `IFO-YYMM-XXXX`, YYMM from the IST date, XXXX 4 random Crockford chars. */
export function generateOrderRef(now: Date, rand: RandomIntFn = defaultRandomInt): string {
  const p = istParts(now);
  const yy = String(p.year % 100).padStart(2, "0");
  const mm = String(p.month).padStart(2, "0");
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    const n = rand(ORDER_REF_ALPHABET.length);
    if (!Number.isInteger(n) || n < 0 || n >= ORDER_REF_ALPHABET.length) {
      throw new RangeError(
        `rand must return an integer in [0, ${ORDER_REF_ALPHABET.length}), got ${n}`,
      );
    }
    suffix += ORDER_REF_ALPHABET.charAt(n);
  }
  return `IFO-${yy}${mm}-${suffix}`;
}

const ORDER_REF_RE = /^IFO-\d{2}(?:0[1-9]|1[0-2])-[0-9A-HJKMNP-TV-Z]{4}$/;

export function isValidOrderRef(ref: string): boolean {
  return ORDER_REF_RE.test(ref);
}

/** Normalise user-typed refs: trim + upper-case (does not validate). */
export function normalizeOrderRef(ref: string): string {
  return ref.trim().toUpperCase();
}

export interface FinancialYear {
  /** Calendar year in which the FY starts (1 April). */
  startYear: number;
  /** "26-27" */
  label: string;
}

/** Indian financial year (1 April - 31 March) of the IST date of `now`. */
export function financialYear(now: Date): FinancialYear {
  const p = istParts(now);
  const startYear = p.month >= 4 ? p.year : p.year - 1;
  const a = String(startYear % 100).padStart(2, "0");
  const b = String((startYear + 1) % 100).padStart(2, "0");
  return { startYear, label: `${a}-${b}` };
}

export const MAX_INVOICE_SEQ = 999_999;

/**
 * `IFO/26-27/000123`. The sequence restarts each financial year (the DB owns the counter).
 * GST rules cap invoice numbers at 16 characters; this format is exactly 16, hence the 6-digit limit.
 */
export function formatInvoiceNumber(seq: number, now: Date): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > MAX_INVOICE_SEQ) {
    throw new RangeError(
      `Invoice sequence must be an integer in 1..${MAX_INVOICE_SEQ}, got ${seq}`,
    );
  }
  return `IFO/${financialYear(now).label}/${String(seq).padStart(6, "0")}`;
}
