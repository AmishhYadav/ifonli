import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { InvoiceLine, InvoiceModel } from "./model";

/**
 * PDF text uses the built-in Helvetica (WinAnsi): it has no rupee sign and no non-Latin scripts.
 * Money is therefore written "Rs. 1,299.00" (also how most Indian invoices print it), and any
 * character Helvetica cannot draw is replaced rather than rendered as garbage.
 */
const REPLACEMENTS: Record<string, string> = {
  "–": "-",
  "—": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "•": "-",
  "₹": "Rs. ",
  "…": "...",
};

export function pdfText(value: string | null | undefined): string {
  if (!value) return "";
  let out = "";
  for (const ch of value.normalize("NFC")) {
    const code = ch.codePointAt(0)!;
    if (REPLACEMENTS[ch] !== undefined) out += REPLACEMENTS[ch];
    else if (code === 0x0a || (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff)) out += ch;
    else if (code === 0xa0) out += " ";
    else out += "?";
  }
  return out;
}

/** "Rs. 1,299.00": integer paise, Indian digit grouping, always two decimals. */
export function pdfMoney(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100).toLocaleString("en-IN");
  const rem = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}Rs. ${rupees}.${rem}`;
}

function pct(rateBp: number): string {
  const v = rateBp / 100;
  return `${Number.isInteger(v) ? v : v.toFixed(2)}%`;
}

function dateText(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

const INK = "#1c1b1a";
const MUTED = "#6b6a66";
const RULE = "#d9d6cf";
const WARN = "#b42318";

const s = StyleSheet.create({
  page: { padding: 36, fontFamily: "Helvetica", fontSize: 9, color: INK, lineHeight: 1.35 },
  banner: { backgroundColor: "#fdecea", borderColor: WARN, borderWidth: 1, padding: 6, marginBottom: 10, color: WARN },
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  brand: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  heading: { fontSize: 15, fontFamily: "Helvetica-Bold", textAlign: "right", marginBottom: 4 },
  muted: { color: MUTED },
  bold: { fontFamily: "Helvetica-Bold" },
  cols: { flexDirection: "row", gap: 16, marginBottom: 14 },
  col: { flex: 1 },
  label: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", marginBottom: 2 },
  tableHead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 3, marginBottom: 2 },
  row: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: RULE },
  right: { textAlign: "right" },
  totals: { marginTop: 10, alignSelf: "flex-end", width: 250 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  grand: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: INK,
    marginTop: 4,
    paddingTop: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
  },
  notes: { marginTop: 18, color: MUTED, fontSize: 8 },
});

interface Col {
  key: string;
  label: string;
  width: number;
  align?: "right";
  cell: (l: InvoiceLine) => string;
}

function columns(model: InvoiceModel): Col[] {
  const base: Col[] = [
    { key: "desc", label: "Item", width: 0, cell: (l) => l.description + (l.sku ? `\nSKU ${l.sku}` : "") },
    { key: "hsn", label: "HSN", width: 42, cell: (l) => l.hsn ?? "-" },
    { key: "qty", label: "Qty", width: 26, align: "right", cell: (l) => String(l.qty) },
    { key: "unit", label: "Unit price", width: 62, align: "right", cell: (l) => pdfMoney(l.unitPricePaise) },
  ];
  if (!model.showTax) {
    return [...base, { key: "amt", label: "Amount", width: 80, align: "right", cell: (l) => pdfMoney(l.grossPaise) }];
  }
  const tax: Col[] = [
    { key: "taxable", label: "Taxable value", width: 62, align: "right", cell: (l) => pdfMoney(l.taxablePaise) },
    { key: "rate", label: "GST", width: 30, align: "right", cell: (l) => pct(l.rateBp) },
  ];
  if (model.interState) {
    tax.push({ key: "igst", label: "IGST", width: 54, align: "right", cell: (l) => pdfMoney(l.igstPaise) });
  } else {
    tax.push(
      { key: "cgst", label: "CGST", width: 50, align: "right", cell: (l) => pdfMoney(l.cgstPaise) },
      { key: "sgst", label: "SGST", width: 50, align: "right", cell: (l) => pdfMoney(l.sgstPaise) },
    );
  }
  return [...base, ...tax, { key: "amt", label: "Total", width: 62, align: "right", cell: (l) => pdfMoney(l.grossPaise) }];
}

/** The first column takes the leftover width; the rest are fixed so every row lines up. */
function cellBox(c: Col) {
  return c.width === 0 ? { flexGrow: 1, flexShrink: 1, flexBasis: 0 } : { width: c.width, flexGrow: 0, flexShrink: 0 };
}

function Party({ title, name, lines }: { title: string; name: string; lines: string[] }) {
  return (
    <View style={s.col}>
      <Text style={s.label}>{title}</Text>
      <Text style={s.bold}>{pdfText(name)}</Text>
      {lines.filter(Boolean).map((l, i) => (
        <Text key={i}>{pdfText(l)}</Text>
      ))}
    </View>
  );
}

export function InvoiceDocument({ model }: { model: InvoiceModel }) {
  const cols = columns(model);
  const t = model.totals;
  const sellerLines = [
    model.seller.address,
    `State: ${model.seller.state}`,
    model.seller.gstin ? `GSTIN: ${model.seller.gstin}` : "Not registered under GST",
  ];
  return (
    <Document title={`${model.heading} ${model.number}`} author={model.seller.legalName} creator="IfOnli">
      <Page size="A4" style={s.page}>
        {model.placeholderFields.length > 0 ? (
          <Text style={s.banner}>
            PLACEHOLDER values on this document (set them in Settings before launch): {model.placeholderFields.join(", ")}.
          </Text>
        ) : null}

        <View style={s.head}>
          <View>
            <Text style={s.brand}>{pdfText(model.seller.brandName)}</Text>
            <Text style={s.muted}>{pdfText(model.seller.legalName)}</Text>
          </View>
          <View>
            <Text style={s.heading}>{pdfText(model.heading)}</Text>
            <Text style={s.right}>No. {pdfText(model.number)}</Text>
            <Text style={s.right}>Date: {dateText(model.issuedAt)}</Text>
          </View>
        </View>

        <View style={s.cols}>
          <Party title="Sold by" name={model.seller.legalName} lines={sellerLines} />
          <Party
            title="Billed and shipped to"
            name={model.buyer.name}
            lines={[...model.buyer.address, model.buyer.phone ? `Phone: ${model.buyer.phone}` : "", model.buyer.email]}
          />
          <View style={s.col}>
            <Text style={s.label}>Order</Text>
            <Text>Order no: {pdfText(model.orderRef)}</Text>
            <Text>Order date: {dateText(model.orderDate)}</Text>
            <Text>Payment: {pdfText(model.paymentLabel)}</Text>
            <Text>Place of supply: {pdfText(model.placeOfSupply)}</Text>
          </View>
        </View>

        <View style={s.tableHead} fixed>
          {cols.map((c) => (
            <Text key={c.key} style={[cellBox(c), { fontSize: 8, fontFamily: "Helvetica-Bold" }, c.align === "right" ? s.right : {}]}>
              {c.label}
            </Text>
          ))}
        </View>
        {[...model.lines, ...model.extraLines].map((l, i) => (
          <View key={i} style={s.row} wrap={false}>
            {cols.map((c) => (
              <Text key={c.key} style={[cellBox(c), c.align === "right" ? s.right : {}]}>
                {pdfText(c.cell(l))}
              </Text>
            ))}
          </View>
        ))}

        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}>
            <Text>Items (incl. GST)</Text>
            <Text>{pdfMoney(t.subtotalPaise)}</Text>
          </View>
          {t.discountPaise > 0 ? (
            <View style={s.totalRow}>
              <Text>Discount{t.couponCode ? ` (${pdfText(t.couponCode)})` : ""}</Text>
              <Text>-{pdfMoney(t.discountPaise)}</Text>
            </View>
          ) : null}
          <View style={s.totalRow}>
            <Text>Shipping</Text>
            <Text>{t.shippingPaise > 0 ? pdfMoney(t.shippingPaise) : "Free"}</Text>
          </View>
          {t.codFeePaise > 0 ? (
            <View style={s.totalRow}>
              <Text>Cash on delivery fee</Text>
              <Text>{pdfMoney(t.codFeePaise)}</Text>
            </View>
          ) : null}
          {model.showTax ? (
            <>
              <View style={s.totalRow}>
                <Text style={s.muted}>Taxable value</Text>
                <Text style={s.muted}>{pdfMoney(t.taxablePaise)}</Text>
              </View>
              {model.interState ? (
                <View style={s.totalRow}>
                  <Text style={s.muted}>IGST</Text>
                  <Text style={s.muted}>{pdfMoney(t.igstPaise)}</Text>
                </View>
              ) : (
                <>
                  <View style={s.totalRow}>
                    <Text style={s.muted}>CGST</Text>
                    <Text style={s.muted}>{pdfMoney(t.cgstPaise)}</Text>
                  </View>
                  <View style={s.totalRow}>
                    <Text style={s.muted}>SGST</Text>
                    <Text style={s.muted}>{pdfMoney(t.sgstPaise)}</Text>
                  </View>
                </>
              )}
            </>
          ) : null}
          <View style={s.grand}>
            <Text>Total</Text>
            <Text>{pdfMoney(t.totalPaise)}</Text>
          </View>
        </View>

        <View style={s.notes}>
          <Text>All prices are inclusive of GST; tax shown above is the amount contained in the price.</Text>
          {model.kind === "bill_of_supply" ? (
            <Text>Bill of supply: the seller is not registered under GST, so no tax is charged separately.</Text>
          ) : null}
          {model.paymentLabel.toLowerCase().includes("cash") ? (
            <Text>Cash on delivery: pay {pdfMoney(t.totalPaise)} to the courier on delivery.</Text>
          ) : null}
          <Text>This is a computer-generated document and needs no signature.</Text>
        </View>
      </Page>
    </Document>
  );
}
