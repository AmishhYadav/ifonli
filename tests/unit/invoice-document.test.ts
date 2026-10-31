import { writeFileSync } from "node:fs";

import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { InvoiceDocument, pdfMoney, pdfText } from "@/server/invoices/InvoiceDocument";
import type { InvoiceLine, InvoiceModel } from "@/server/invoices/model";

const line = (over: Partial<InvoiceLine> = {}): InvoiceLine => ({
  description: "Skull charm",
  sku: "SKU-1",
  hsn: "7117",
  qty: 2,
  unitPricePaise: 19900,
  grossPaise: 39800,
  taxablePaise: 33729,
  rateBp: 1800,
  cgstPaise: 3035,
  sgstPaise: 3036,
  igstPaise: 0,
  ...over,
});

function model(over: Partial<InvoiceModel> = {}): InvoiceModel {
  const l = line();
  const ship = line({ description: "Shipping", sku: null, hsn: null, qty: 1, unitPricePaise: 5000, grossPaise: 5000, taxablePaise: 4237, cgstPaise: 381, sgstPaise: 382 });
  return {
    kind: "tax_invoice",
    heading: "Tax invoice",
    number: "IFO/26-27/000123",
    issuedAt: new Date("2026-10-31T10:00:00Z"),
    orderRef: "IFO-2610-ABCD",
    orderDate: new Date("2026-10-31T09:00:00Z"),
    paymentLabel: "Paid online",
    seller: { legalName: "IfOnli Creations Pvt Ltd", brandName: "IfOnli", address: "12 Marine Drive, Mumbai 400001", state: "Maharashtra", gstin: "27ABCDE1234F1Z5" },
    placeholderFields: [],
    buyer: { name: "Asha Rao", email: "asha@example.com", phone: "+919876543210", address: ["12 Marine Drive", "Mumbai 400001", "Maharashtra"], state: "Maharashtra", stateCode: "27" },
    placeOfSupply: "Maharashtra (27)",
    interState: false,
    showTax: true,
    lines: [l],
    extraLines: [ship],
    totals: { subtotalPaise: 39800, discountPaise: 0, couponCode: null, shippingPaise: 5000, codFeePaise: 0, taxablePaise: 37966, cgstPaise: 3416, sgstPaise: 3418, igstPaise: 0, totalPaise: 44800 },
    ...over,
  };
}

describe("invoice document helpers", () => {
  it("formats money as Rs. with Indian grouping and two decimals", () => {
    expect(pdfMoney(0)).toBe("Rs. 0.00");
    expect(pdfMoney(129950)).toBe("Rs. 1,299.50");
    expect(pdfMoney(123456789)).toBe("Rs. 12,34,567.89");
    expect(pdfMoney(-500)).toBe("-Rs. 5.00");
  });

  it("replaces characters Helvetica cannot draw instead of emitting garbage", () => {
    expect(pdfText("₹5 – “ok” …")).toBe('Rs. 5 - "ok" ...');
    expect(pdfText("Café")).toBe("Café");
    expect(pdfText("राहुल")).toBe("?????");
    expect(pdfText(null)).toBe("");
  });
});

describe("InvoiceDocument", () => {
  const render = async (m: InvoiceModel) => renderToBuffer(InvoiceDocument({ model: m }) as ReactElement<DocumentProps>);

  it("renders valid PDFs for tax invoice (CGST/SGST and IGST) and bill of supply", async () => {
    const intra = await render(model());
    const inter = await render(
      model({ interState: true, lines: [line({ cgstPaise: 0, sgstPaise: 0, igstPaise: 6071 })], totals: { ...model().totals, cgstPaise: 0, sgstPaise: 0, igstPaise: 6834 } }),
    );
    const bos = await render(model({ kind: "bill_of_supply", heading: "Bill of supply", showTax: false, seller: { ...model().seller, gstin: null }, placeholderFields: ["legal name"] }));
    for (const pdf of [intra, inter, bos]) {
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      expect(pdf.length).toBeGreaterThan(1500);
    }
    if (process.env.INVOICE_PDF_OUT) {
      writeFileSync(`${process.env.INVOICE_PDF_OUT}/inv-tax.pdf`, intra);
      writeFileSync(`${process.env.INVOICE_PDF_OUT}/inv-igst.pdf`, inter);
      writeFileSync(`${process.env.INVOICE_PDF_OUT}/inv-bos.pdf`, bos);
    }
  });
});
