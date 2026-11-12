import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The route also accepts a signed-in owner; these tests call it outside a Next request, as an
// anonymous visitor, so the session lookup is stubbed to "nobody signed in".
vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getOptionalCustomer: vi.fn(async () => null),
}));

import { GET as customerInvoice } from "@/app/api/orders/[ref]/invoice/route";
import { getDb } from "@/server/db";
import { invoices } from "@/server/db/schema";
import { MockPaymentProvider } from "@/server/payments/mock";
import { setPaymentProvider } from "@/server/payments/registry";
import {
  buildInvoiceModel,
  ensureInvoicePdf,
  getInvoiceDownloadUrl,
  InvoiceError,
  invoiceStoragePath,
  renderInvoicePdf,
  type InvoiceStorage,
} from "@/server/services/invoices";
import { setSetting } from "@/server/services/settings";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { configureCommerce, placeCodOrder, placePaidOrder, placePrepaidOrder, seedCommerceReference } from "./helpers/factories";

const db = () => getDb();
let f: Fixture;
let provider: MockPaymentProvider;

function memoryStorage() {
  const files = new Map<string, Uint8Array>();
  const storage: InvoiceStorage = {
    async put(path, bytes) {
      files.set(path, bytes);
    },
    async signedUrl(path, ttl) {
      return `https://storage.test/${path}?ttl=${ttl}`;
    },
  };
  return { files, storage };
}

const setStore = async (values: Record<string, unknown>) => {
  for (const [k, v] of Object.entries(values)) {
    await (setSetting as (k: string, v: unknown, a: string | null) => Promise<unknown>)(k, v, null);
  }
};
const STORE = {
  legal_name: "IfOnli Creations Pvt Ltd",
  registered_address: "12 Marine Drive, Mumbai 400001",
  state: "Maharashtra",
};

beforeEach(async () => {
  provider = new MockPaymentProvider({ deterministic: true });
  setPaymentProvider(provider);
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce();
});
afterEach(() => setPaymentProvider(null));

describe("invoice numbers", () => {
  it("COD orders get an invoice number at placement; prepaid at payment", async () => {
    const cod = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }]);
    const [row] = await db().select().from(invoices).where(eq(invoices.orderId, cod.order.orderId));
    expect(row!.number).toMatch(/^IFO\/\d{2}-\d{2}\/000001$/);
    expect(row!.kind).toBe("bill_of_supply");

    const pending = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    expect(await db().select().from(invoices).where(eq(invoices.orderId, pending.order.orderId))).toHaveLength(0);
    const paid = await placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const [p] = await db().select().from(invoices).where(eq(invoices.orderId, paid.order.orderId));
    expect(p!.number).toMatch(/000002$/);
  });
});

describe("invoice model and PDF", () => {
  it("renders a tax invoice with CGST+SGST for an intra-state buyer", async () => {
    await setStore({ ...STORE, gstin: "27ABCDE1234F1Z5" });
    const { order } = await placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }]);
    const model = await buildInvoiceModel(db(), order.orderId);
    expect(model).toMatchObject({ kind: "tax_invoice", heading: "Tax invoice", interState: false, showTax: true });
    expect(model.placeholderFields).toEqual([]);
    expect(model.seller).toMatchObject({ legalName: STORE.legal_name, gstin: "27ABCDE1234F1Z5" });
    // 2 x 199.00 at the fixture product's 3% GST (inclusive), shipping 50.00
    expect(model.lines[0]).toMatchObject({ qty: 2, grossPaise: 39800, taxablePaise: 38641, rateBp: 300 });
    expect(model.extraLines.map((l) => l.description)).toEqual(["Shipping"]);
    const t = model.totals;
    expect(t.totalPaise).toBe(44800);
    expect(t.igstPaise).toBe(0);
    expect(t.cgstPaise + t.sgstPaise).toBe(t.totalPaise - t.taxablePaise);
    const order_ = (await db().query.orders.findFirst({ where: (o, { eq: e }) => e(o.id, order.orderId) }))!;
    expect(t.cgstPaise + t.sgstPaise).toBe(order_.taxIncludedPaise);

    const pdf = await renderInvoicePdf(model);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1500);
  });

  it("prints no tax columns or rows when the order contains no GST, even for a GST-registered seller", async () => {
    await setStore({ ...STORE, gstin: "27ABCDE1234F1Z5" });
    await configureCommerce({ default_gst_rate_bp: 0 });
    const { order } = await placePaidOrder(provider, [{ variantId: f.variants.cat!, qty: 1 }]); // default rate = 0
    const row = (await db().query.orders.findFirst({ where: (o, { eq: e }) => e(o.id, order.orderId) }))!;
    expect(row.taxIncludedPaise).toBe(0);
    const model = await buildInvoiceModel(db(), order.orderId);
    expect(model).toMatchObject({ showTax: false, totals: { cgstPaise: 0, sgstPaise: 0, igstPaise: 0 } });
    expect((await renderInvoicePdf(model)).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("uses IGST for an inter-state buyer and lists the COD fee", async () => {
    await setStore({ ...STORE, gstin: "27ABCDE1234F1Z5" });
    const { order } = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }], {
      form: {
        shippingAddress: { name: "Ravi", line1: "1 Rajpath", city: "New Delhi", state: "Delhi", pincode: "110001" },
      },
    });
    const model = await buildInvoiceModel(db(), order.orderId);
    expect(model).toMatchObject({ interState: true, kind: "tax_invoice", paymentLabel: "Cash on delivery" });
    expect(model.extraLines.map((l) => l.description)).toEqual(["Shipping", "Cash on delivery fee"]);
    expect(model.totals.cgstPaise).toBe(0);
    expect(model.totals.igstPaise).toBeGreaterThan(0);
    expect(model.placeOfSupply).toContain("Delhi");
    expect((await renderInvoicePdf(model)).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("renders a bill of supply without tax columns and marks placeholder settings", async () => {
    // legal name / address / state left at their launch placeholders
    const { order } = await placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const model = await buildInvoiceModel(db(), order.orderId);
    expect(model).toMatchObject({ kind: "bill_of_supply", heading: "Bill of supply", showTax: false });
    expect(model.seller.gstin).toBeNull();
    expect(model.placeholderFields).toEqual(expect.arrayContaining(["legal name", "registered address"]));
    expect(model.seller.legalName).toMatch(/PLACEHOLDER/);
    const pdf = await renderInvoicePdf(model);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});

describe("invoice storage", () => {
  it("renders once, stores under invoices/{fy}/{number}.pdf and reuses it", async () => {
    await setStore(STORE);
    const { order } = await placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const mem = memoryStorage();
    const first = await ensureInvoicePdf(db(), order.orderId, { storage: mem.storage });
    expect(first.generated).toBe(true);
    expect(first.path).toMatch(/^invoices\/\d{2}-\d{2}\/IFO-\d{2}-\d{2}-000001\.pdf$/);
    expect(first.path).toBe(invoiceStoragePath(first.number));
    expect(Buffer.from(mem.files.get(first.path)!).subarray(0, 4).toString()).toBe("%PDF");
    const second = await ensureInvoicePdf(db(), order.orderId, { storage: mem.storage });
    expect(second).toMatchObject({ generated: false, path: first.path });
    expect(mem.files.size).toBe(1);
    const [row] = await db().select().from(invoices).where(eq(invoices.orderId, order.orderId));
    expect(row!.pdfPath).toBe(first.path);

    const link = await getInvoiceDownloadUrl(db(), order.orderId, { storage: mem.storage, expiresInSeconds: 120 });
    expect(link.url).toBe(`https://storage.test/${first.path}?ttl=120`);
  });

  it("back-fills a missing invoice number for a confirmed order, refuses unpaid orders", async () => {
    const { order } = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }]);
    await db().delete(invoices).where(eq(invoices.orderId, order.orderId)); // legacy COD order
    const mem = memoryStorage();
    const stored = await ensureInvoicePdf(db(), order.orderId, { storage: mem.storage });
    expect(stored.number).toMatch(/^IFO\//);

    const pending = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    await expect(ensureInvoicePdf(db(), pending.order.orderId, { storage: mem.storage })).rejects.toBeInstanceOf(InvoiceError);
    await expect(
      ensureInvoicePdf(db(), "00000000-0000-4000-8000-000000000000", { storage: mem.storage }),
    ).rejects.toMatchObject({ code: "order_not_found" });
  });
});

describe("customer invoice route", () => {
  const call = (ref: string, token?: string) =>
    customerInvoice(
      new Request(`http://localhost/api/orders/${ref}/invoice${token === undefined ? "" : `?t=${token}`}`),
      { params: Promise.resolve({ ref }) } as never,
    );

  it("rejects a wrong, missing or someone else's token with a 404", async () => {
    const a = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }]);
    const b = await placeCodOrder([{ variantId: f.variants.skull!, qty: 1 }]);
    for (const res of [
      await call(a.order.ref, "not-the-token"),
      await call(a.order.ref),
      await call(a.order.ref, b.token),
      await call("IFO-0000-ZZZZ", a.token),
    ]) {
      expect(res.status).toBe(404);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("does not issue an invoice for an order that is not yet paid", async () => {
    const pending = await placePrepaidOrder(provider, [{ variantId: f.variants.skull!, qty: 1 }]);
    const res = await call(pending.order.ref, pending.token);
    expect(res.status).toBe(404);
  });
});
