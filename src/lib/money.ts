/**
 * Money helpers. All amounts are integer paise (1 INR = 100 paise). Never use floats for money.
 */

const inrWhole = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const inrFraction = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format paise as INR: whole rupees show no decimals (₹1,299), otherwise 2 (₹1,299.50). */
export function formatINR(paise: number | bigint): string {
  const value = BigInt(paise);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const rupees = abs / 100n;
  const rem = abs % 100n;
  // Format via the integer rupee part to stay exact for large bigint values.
  const formatter = rem === 0n ? inrWhole : inrFraction;
  const out =
    rem === 0n ? formatter.format(rupees) : formatter.format(Number(rupees) + Number(rem) / 100);
  return negative ? `-${out}` : out;
}

/** Convert rupees (may have up to 2 decimals) to integer paise, rounding half away from zero. */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) {
    throw new RangeError("rupees must be a finite number");
  }
  const sign = rupees < 0 ? -1 : 1;
  // Add epsilon-safe rounding: 1.005 * 100 = 100.49999999999999
  return sign * Math.round(Math.abs(rupees) * 100 + Number.EPSILON * 100);
}

/** Convert integer paise to a rupee number (for display math only, never for storage). */
export function paiseToRupees(paise: number | bigint): number {
  return Number(paise) / 100;
}

/** Sum a list of paise amounts. Returns a number; use bigint inputs for very large totals. */
export function sumPaise(values: ReadonlyArray<number>): number {
  let total = 0;
  for (const v of values) {
    if (!Number.isInteger(v)) {
      throw new RangeError(`paise must be an integer, got ${v}`);
    }
    total += v;
  }
  return total;
}

/**
 * True when the prices differ, i.e. a product card/summary must say "From" because the shown price is
 * only the cheapest of several. Same-price variants (e.g. colour options) are NOT a range.
 */
export function hasPriceRange(pricesPaise: readonly number[]): boolean {
  const first = pricesPaise[0];
  return first !== undefined && pricesPaise.some((p) => p !== first);
}
