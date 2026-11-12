import { Defs, Document, Image, LinearGradient, Page, Rect, Stop, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";

import { LOGO_DATA_URI } from "./logo";
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

/*
 * Colours are sampled from the cat badge (public/brand/ifonli-logo.png): brick-red lettering, a coral-to-butter sunset
 * and black outlines. The page stays mostly white so it prints cheaply; the colour sits in the frame, the header
 * band, the table head and the total.
 */
const INK = "#1f1a17";
const MUTED = "#7a5a4e";
const ACCENT = "#b5311c";
const ON_ACCENT = "#ffffff";
const CORAL = "#ec7f76";
const PEACH = "#eeb083";
const BUTTER = "#f7d985";
const TINT = "#fff6ec";
const RULE = "#f1d9c4";
const WARN = "#b42318";

const s = StyleSheet.create({
  page: { paddingVertical: 40, paddingHorizontal: 40, fontFamily: "Helvetica", fontSize: 9, color: INK, lineHeight: 1.35 },
  /* Repeated on every page: a square-cornered double rule, heavy outside and hairline inside. */
  frame: { position: "absolute", top: 14, left: 14, right: 14, bottom: 14, borderWidth: 2.5, borderColor: ACCENT },
  frameInner: { position: "absolute", top: 19, left: 19, right: 19, bottom: 19, borderWidth: 0.75, borderColor: ACCENT },
  banner: { backgroundColor: "#fdecea", borderColor: WARN, borderWidth: 1, padding: 6, marginBottom: 10, color: WARN },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    padding: 14,
    borderBottomWidth: 2,
    borderBottomColor: ACCENT,
    overflow: "hidden",
  },
  headBg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 58, height: 58 },
  brand: { fontSize: 22, fontFamily: "Helvetica-Bold", color: ACCENT, lineHeight: 1 },
  tagline: { fontSize: 8, color: MUTED, marginTop: 3 },
  headingBox: { alignItems: "flex-end" },
  heading: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: ON_ACCENT,
    backgroundColor: ACCENT,
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 6,
  },
  muted: { color: MUTED },
  bold: { fontFamily: "Helvetica-Bold" },
  cols: { flexDirection: "row", gap: 10, marginBottom: 16 },
  col: { flex: 1, padding: 9, backgroundColor: TINT, borderWidth: 0.75, borderColor: RULE },
  label: { fontSize: 7, fontFamily: "Helvetica-Bold", color: ACCENT, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  tableHead: {
    flexDirection: "row",
    backgroundColor: ACCENT,
    color: ON_ACCENT,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  row: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: RULE },
  rowAlt: { backgroundColor: TINT },
  right: { textAlign: "right" },
  totals: { marginTop: 12, alignSelf: "flex-end", width: 250, padding: 10, backgroundColor: TINT, borderWidth: 0.75, borderColor: RULE },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  grand: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: ACCENT,
    color: ON_ACCENT,
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
  },
  thanks: { marginTop: 22, fontSize: 13, fontFamily: "Helvetica-Bold", color: ACCENT },
  thanksSub: { marginTop: 2, color: MUTED },
  notes: { marginTop: 12, paddingTop: 8, borderTopWidth: 0.75, borderTopColor: RULE, borderTopStyle: "dashed", color: MUTED, fontSize: 8 },
  dots: { position: "absolute", bottom: 26, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
});

/** The badge's sunset (coral at the top fading to butter) behind the header. */
function HeaderWash() {
  return (
    <Svg style={s.headBg} viewBox="0 0 100 100" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={CORAL} stopOpacity={0.55} />
          <Stop offset="0.5" stopColor={PEACH} stopOpacity={0.45} />
          <Stop offset="1" stopColor={BUTTER} stopOpacity={0.55} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={100} height={100} fill="url(#wash)" />
    </Svg>
  );
}

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
    model.seller.gstin ? `GSTIN: ${model.seller.gstin}` : "",
  ];
  return (
    <Document title={`${model.heading} ${model.number}`} author={model.seller.legalName} creator="IfOnli">
      <Page size="A4" style={s.page}>
        <View style={s.frame} fixed />
        <View style={s.frameInner} fixed />
        <View style={s.dots} fixed>
          {[ACCENT, CORAL, BUTTER, CORAL, ACCENT].map((c, i) => (
            <View key={i} style={[s.dot, { backgroundColor: c }]} />
          ))}
        </View>

        {model.placeholderFields.length > 0 ? (
          <Text style={s.banner}>
            PLACEHOLDER values on this document (set them in Settings before launch): {model.placeholderFields.join(", ")}.
          </Text>
        ) : null}

        <View style={s.head}>
          <HeaderWash />
          <View style={s.brandRow}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt; the PDF title names the brand. */}
            <Image style={s.logo} src={LOGO_DATA_URI} />
            <View>
              <Text style={s.brand}>{pdfText(model.seller.brandName)}</Text>
              <Text style={s.tagline}>{pdfText(model.seller.legalName)}</Text>
            </View>
          </View>
          <View style={s.headingBox}>
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
            <Text key={c.key} style={[cellBox(c), { fontSize: 8, fontFamily: "Helvetica-Bold", color: ON_ACCENT }, c.align === "right" ? s.right : {}]}>
              {c.label}
            </Text>
          ))}
        </View>
        {[...model.lines, ...model.extraLines].map((l, i) => (
          <View key={i} style={i % 2 === 1 ? [s.row, s.rowAlt] : s.row} wrap={false}>
            {cols.map((c) => (
              <Text key={c.key} style={[cellBox(c), c.align === "right" ? s.right : {}]}>
                {pdfText(c.cell(l))}
              </Text>
            ))}
          </View>
        ))}

        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}>
            <Text>{model.showTax ? "Items (incl. GST)" : "Items"}</Text>
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

        <View wrap={false}>
          <Text style={s.thanks}>Thank you for shopping with {pdfText(model.seller.brandName)}!</Text>
          <Text style={s.thanksSub}>Hope your order makes you smile. Order {pdfText(model.orderRef)}.</Text>
        </View>

        <View style={s.notes}>
          {model.showTax ? (
            <Text>All prices are inclusive of GST; tax shown above is the amount contained in the price.</Text>
          ) : (
            <Text>All prices are inclusive of all taxes; no tax is charged separately.</Text>
          )}
          {model.paymentLabel.toLowerCase().includes("cash") ? (
            <Text>Cash on delivery: pay {pdfMoney(t.totalPaise)} to the courier on delivery.</Text>
          ) : null}
          <Text>This is a computer-generated document and needs no signature.</Text>
        </View>
      </Page>
    </Document>
  );
}
