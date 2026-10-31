import "server-only";

import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { ReactElement } from "react";

import { invoices, orderItems, orders } from "@/server/db/schema";
import { splitGst, taxIncludedIn } from "@/server/domain";
import { InvoiceDocument } from "@/server/invoices/InvoiceDocument";
import type { InvoiceLine, InvoiceModel } from "@/server/invoices/model";
import { createSignedReadUrl, createSignedUploadUrl, StorageError } from "@/server/storage";

import { loadCommerceSettings } from "./commerce/settings";
import { ensureInvoiceNumber } from "./invoice-number";
import { readSettings, type DbClient } from "./queries/shared";

/** Invoices live in the private bucket under `invoices/{fy}/{number}.pdf` ("/" in the number becomes "-"). */
export const INVOICE_BUCKET = "private";
/** How long a download link works. */
export const INVOICE_URL_TTL_SECONDS = 300;

export type InvoiceErrorCode = "order_not_found" | "not_invoiceable";

export class InvoiceError extends Error {
  constructor(
    readonly code: InvoiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InvoiceError";
  }
}

/** Where PDFs are kept. The default is Supabase Storage (`private` bucket); tests inject a memory store. */
export interface InvoiceStorage {
  /** Stores the bytes at `path`. Writing an existing path again must not throw. */
  put(path: string, bytes: Uint8Array): Promise<void>;
  signedUrl(path: string, expiresInSeconds: number): Promise<string>;
}

export const supabaseInvoiceStorage: InvoiceStorage = {
  async put(path, bytes) {
    const upload = await createSignedUploadUrl(INVOICE_BUCKET, path);
    const res = await fetch(upload.url, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf", "x-upsert": "false" },
      body: bytes as unknown as BodyInit,
      cache: "no-store",
    });
    // 409 / 400 "already exists": a concurrent render stored the same invoice first.
    if (!res.ok && res.status !== 409 && res.status !== 400) {
      throw new StorageError(`Uploading invoice failed (${res.status})`, res.status);
    }
  },
  signedUrl: (path, ttl) => createSignedReadUrl(INVOICE_BUCKET, path, ttl),
};

/** `invoices/26-27/IFO-26-27-000123.pdf` for `IFO/26-27/000123`. */
export function invoiceStoragePath(number: string): string {
  const fy = number.split("/")[1] ?? "unknown";
  return `invoices/${fy}/${number.replace(/\//g, "-")}.pdf`;
}

/* ------------------------------------------------------------------------------------------ */
/* Model                                                                                      */
/* ------------------------------------------------------------------------------------------ */

const PLACEHOLDER_RE = /PLACEHOLDER/i;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Builds the invoice data for an order that has an invoice number: store details from settings
 * (placeholders flagged, never silently blank), line tax from the order snapshot, shipping and COD
 * fee as their own taxed lines, and the CGST+SGST / IGST split from the seller and buyer states.
 */
export async function buildInvoiceModel(db: DbClient, orderId: string): Promise<InvoiceModel> {
  const [row] = await db
    .select({ order: orders, invoice: invoices })
    .from(orders)
    .innerJoin(invoices, eq(invoices.orderId, orders.id))
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!row) throw new InvoiceError("order_not_found", "No invoice for that order.");
  const { order, invoice } = row;

  const [items, s, commerce] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.createdAt), asc(orderItems.id)),
    readSettings(db, ["legal_name", "brand_name", "registered_address", "state", "gstin"]),
    loadCommerceSettings(db),
  ]);

  const placeholderFields: string[] = [];
  const stored = (key: "legal_name" | "brand_name" | "registered_address" | "state", fieldLabel: string): string => {
    const r = s[key];
    const value = r.value;
    if (r.isPlaceholder || PLACEHOLDER_RE.test(value)) {
      placeholderFields.push(fieldLabel);
      return PLACEHOLDER_RE.test(value) ? value : `PLACEHOLDER - ${value}`;
    }
    return value;
  };
  const seller = {
    legalName: stored("legal_name", "legal name"),
    brandName: s.brand_name.value,
    address: stored("registered_address", "registered address"),
    state: stored("state", "business state"),
    gstin: s.gstin.value,
  };

  const address = (order.shippingAddress ?? {}) as Record<string, unknown>;
  const buyerStateCode = str(address.stateCode) || "00";
  const sellerStateCode = commerce.tax.sellerStateCode;
  const parties = { sellerStateCode, buyerStateCode };
  const interState = sellerStateCode !== buyerStateCode;
  const showTax = invoice.kind === "tax_invoice";

  const makeLine = (
    l: Pick<InvoiceLine, "description" | "sku" | "hsn" | "qty" | "unitPricePaise">,
    grossPaise: number,
    taxPaise: number,
    rateBp: number,
  ): InvoiceLine => {
    const split = splitGst(taxPaise, parties);
    return {
      ...l,
      grossPaise,
      taxablePaise: grossPaise - taxPaise,
      rateBp,
      cgstPaise: split.cgst,
      sgstPaise: split.sgst,
      igstPaise: split.igst,
    };
  };

  const lines = items.map((i) =>
    makeLine(
      {
        description: i.variantTitle && i.variantTitle !== "Default" ? `${i.productName} (${i.variantTitle})` : i.productName,
        sku: i.sku,
        hsn: i.hsn,
        qty: i.qty,
        unitPricePaise: i.unitPricePaise,
      },
      i.lineTotalPaise,
      i.taxPaise,
      i.gstRateBp ?? 0,
    ),
  );

  // Shipping / COD fee tax: the order only stores the total GST, so the rate is re-derived the way
  // pricing does (dominant line rate, or the fixed setting) and the COD line takes the remainder.
  const lineTax = items.reduce((sum, i) => sum + i.taxPaise, 0);
  const extraTax = Math.max(0, order.taxIncludedPaise - lineTax);
  const rule = commerce.tax.shippingTaxRule;
  let rateBp = 0;
  if (rule.kind === "fixed") rateBp = rule.rateBp;
  else {
    const sums = new Map<number, number>();
    for (const i of items) sums.set(i.gstRateBp ?? 0, (sums.get(i.gstRateBp ?? 0) ?? 0) + i.lineTotalPaise);
    let best = -1;
    for (const [rate, sum] of sums) {
      if (sum > best || (sum === best && rate > rateBp)) {
        best = sum;
        rateBp = rate;
      }
    }
  }
  const shippingTax = Math.min(extraTax, taxIncludedIn(order.shippingPaise, rateBp).taxPaise);
  const codTax = Math.min(order.codFeePaise, extraTax - shippingTax);
  const extraLines: InvoiceLine[] = [];
  if (order.shippingPaise > 0) {
    extraLines.push(
      makeLine({ description: "Shipping", sku: null, hsn: null, qty: 1, unitPricePaise: order.shippingPaise }, order.shippingPaise, shippingTax, rateBp),
    );
  }
  if (order.codFeePaise > 0) {
    extraLines.push(
      makeLine({ description: "Cash on delivery fee", sku: null, hsn: null, qty: 1, unitPricePaise: order.codFeePaise }, order.codFeePaise, codTax, rateBp),
    );
  }

  const all = [...lines, ...extraLines];
  const sum = (pick: (l: InvoiceLine) => number) => all.reduce((t, l) => t + pick(l), 0);
  const stateName = str(address.state);

  return {
    kind: invoice.kind,
    heading: invoice.kind === "tax_invoice" ? "Tax invoice" : "Bill of supply",
    number: invoice.number,
    issuedAt: invoice.createdAt,
    orderRef: order.ref,
    orderDate: order.placedAt,
    paymentLabel: order.paymentMethod === "cod" ? "Cash on delivery" : "Paid online",
    seller,
    placeholderFields,
    buyer: {
      name: str(address.name) || order.email,
      email: order.email,
      phone: order.phone,
      address: [str(address.line1), str(address.line2), str(address.landmark), `${str(address.city)} ${str(address.pincode)}`.trim(), stateName].filter(Boolean),
      state: stateName,
      stateCode: buyerStateCode,
    },
    placeOfSupply: stateName ? `${stateName}${buyerStateCode !== "00" ? ` (${buyerStateCode})` : ""}` : "-",
    interState,
    showTax,
    lines,
    extraLines,
    totals: {
      subtotalPaise: order.subtotalPaise,
      discountPaise: order.discountPaise,
      couponCode: order.couponCode,
      shippingPaise: order.shippingPaise,
      codFeePaise: order.codFeePaise,
      taxablePaise: sum((l) => l.taxablePaise),
      cgstPaise: sum((l) => l.cgstPaise),
      sgstPaise: sum((l) => l.sgstPaise),
      igstPaise: sum((l) => l.igstPaise),
      totalPaise: order.totalPaise,
    },
  };
}

/** Renders the invoice PDF (a Buffer starting with `%PDF`). */
export async function renderInvoicePdf(model: InvoiceModel): Promise<Buffer> {
  return renderToBuffer(InvoiceDocument({ model }) as ReactElement<DocumentProps>);
}

/* ------------------------------------------------------------------------------------------ */
/* Store + download                                                                           */
/* ------------------------------------------------------------------------------------------ */

export interface StoredInvoice {
  number: string;
  path: string;
  kind: "tax_invoice" | "bill_of_supply";
  /** True when this call rendered and stored the PDF (false: it already existed). */
  generated: boolean;
}

/**
 * The invoice's PDF in storage, rendering it once. Idempotent: `invoices.pdf_path` is the marker, so
 * later calls reuse the stored file. An order with no invoice number yet (legacy COD orders placed
 * before COD was invoiced at placement) gets one now, as long as it is confirmed.
 */
export async function ensureInvoicePdf(
  db: DbClient,
  orderId: string,
  opts: { storage?: InvoiceStorage; now?: Date } = {},
): Promise<StoredInvoice> {
  const storage = opts.storage ?? supabaseInvoiceStorage;
  const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) throw new InvoiceError("order_not_found", "Order not found.");

  let [inv] = await db.select().from(invoices).where(eq(invoices.orderId, orderId)).limit(1);
  if (!inv) {
    if (order.status !== "confirmed" && order.status !== "processing" && order.status !== "completed") {
      throw new InvoiceError("not_invoiceable", "An invoice is issued once the order is confirmed.");
    }
    await db.transaction((tx) => ensureInvoiceNumber(tx, orderId, opts.now ?? new Date()));
    [inv] = await db.select().from(invoices).where(eq(invoices.orderId, orderId)).limit(1);
  }
  if (!inv) throw new InvoiceError("not_invoiceable", "No invoice for that order.");
  if (inv.pdfPath) return { number: inv.number, path: inv.pdfPath, kind: inv.kind, generated: false };

  const model = await buildInvoiceModel(db, orderId);
  const bytes = await renderInvoicePdf(model);
  const path = invoiceStoragePath(inv.number);
  await storage.put(path, bytes);
  // First writer wins; a concurrent renderer stores identical content at the same path.
  await db
    .update(invoices)
    .set({ pdfPath: path })
    .where(and(eq(invoices.id, inv.id), isNull(invoices.pdfPath)));
  return { number: inv.number, path, kind: inv.kind, generated: true };
}

/** Short-lived signed link to the invoice PDF (rendering it first if needed). */
export async function getInvoiceDownloadUrl(
  db: DbClient,
  orderId: string,
  opts: { storage?: InvoiceStorage; expiresInSeconds?: number; now?: Date } = {},
): Promise<{ url: string; number: string; path: string }> {
  const storage = opts.storage ?? supabaseInvoiceStorage;
  const stored = await ensureInvoicePdf(db, orderId, opts);
  const url = await storage.signedUrl(stored.path, opts.expiresInSeconds ?? INVOICE_URL_TTL_SECONDS);
  return { url, number: stored.number, path: stored.path };
}
