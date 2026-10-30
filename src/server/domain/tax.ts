/**
 * GST helpers. Every IfOnli price is GST-inclusive (B2C India); tax is extracted, never added.
 * All arithmetic is integer (BigInt where products could lose precision).
 */

export class TaxError extends Error {
  override name = "TaxError";
}

export interface TaxBreakdown {
  /** Value excluding tax. */
  taxablePaise: number;
  /** GST contained in the gross amount. */
  taxPaise: number;
}

export interface GstSplit {
  cgst: number;
  sgst: number;
  igst: number;
}

function assertNonNegativeInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TaxError(`${name} must be a non-negative integer, got ${value}`);
  }
}

/**
 * Extract GST from a GST-inclusive gross amount.
 * `taxable = round_half_up(gross * 10000 / (10000 + rateBp))`, `tax = gross - taxable`.
 */
export function taxIncludedIn(grossPaise: number, rateBp: number): TaxBreakdown {
  assertNonNegativeInt(grossPaise, "grossPaise");
  assertNonNegativeInt(rateBp, "rateBp");
  const gross = BigInt(grossPaise);
  const denom = 10000n + BigInt(rateBp);
  // round half up of (gross * 10000) / denom  ==  floor((2 * num + denom) / (2 * denom))
  const taxable = (2n * gross * 10000n + denom) / (2n * denom);
  const taxablePaise = Number(taxable);
  return { taxablePaise, taxPaise: grossPaise - taxablePaise };
}

export interface GstSplitParties {
  /** 2-digit GST state code of the seller (place of supply), e.g. "27". */
  sellerStateCode: string;
  /** 2-digit GST state code of the buyer. */
  buyerStateCode: string;
}

const STATE_CODE = /^\d{2}$/;

/**
 * Split a tax amount into CGST+SGST (intra-state) or IGST (inter-state).
 * Intra-state: `cgst = floor(tax / 2)`, `sgst = tax - cgst` (the odd paisa goes to SGST).
 */
export function splitGst(taxPaise: number, parties: GstSplitParties): GstSplit {
  assertNonNegativeInt(taxPaise, "taxPaise");
  for (const [k, v] of Object.entries(parties)) {
    if (!STATE_CODE.test(v)) {
      throw new TaxError(`${k} must be a 2-digit GST state code, got "${v}"`);
    }
  }
  if (parties.sellerStateCode === parties.buyerStateCode) {
    const cgst = Math.floor(taxPaise / 2);
    return { cgst, sgst: taxPaise - cgst, igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: taxPaise };
}
