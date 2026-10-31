/**
 * The invoice as plain data (no React, no DB): built by `services/invoices.ts`, rendered by
 * `InvoiceDocument.tsx`. Money is integer paise; GST is already extracted from the inclusive prices.
 */

export type InvoiceKind = "tax_invoice" | "bill_of_supply";

export interface InvoiceParty {
  name: string;
  lines: string[];
}

export interface InvoiceLine {
  description: string;
  sku: string | null;
  hsn: string | null;
  qty: number;
  /** Gross (GST-inclusive) price per unit. */
  unitPricePaise: number;
  /** Gross amount charged for the line, after any coupon share. */
  grossPaise: number;
  /** Value excluding GST. */
  taxablePaise: number;
  rateBp: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

export interface InvoiceModel {
  kind: InvoiceKind;
  /** "Tax invoice" or "Bill of supply". */
  heading: string;
  number: string;
  issuedAt: Date;
  orderRef: string;
  orderDate: Date;
  paymentLabel: string;
  seller: {
    legalName: string;
    brandName: string;
    address: string;
    state: string;
    /** null = not registered under GST. */
    gstin: string | null;
  };
  /** Setting labels whose stored value is still a launch placeholder. */
  placeholderFields: string[];
  buyer: { name: string; email: string; phone: string | null; address: string[]; state: string; stateCode: string };
  placeOfSupply: string;
  /** True when seller and buyer states differ (IGST). */
  interState: boolean;
  /** Tax columns are shown only on a tax invoice. */
  showTax: boolean;
  lines: InvoiceLine[];
  /** Shipping and COD fee as their own (taxed) lines. */
  extraLines: InvoiceLine[];
  totals: {
    subtotalPaise: number;
    discountPaise: number;
    couponCode: string | null;
    shippingPaise: number;
    codFeePaise: number;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    totalPaise: number;
  };
}
