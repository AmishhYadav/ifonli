import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { vibes } from "@/features/vibe/tokens";
import { VIBES } from "@/features/vibe/config";
import { TEMPLATE_NAMES, TEMPLATES, UnknownTemplateError, oneLine, renderTemplate } from "@/server/notify/templates";

import { FIXTURE_PAYLOADS, fixtureContext } from "../../emails/fixtures";
import { payloadSchemas, type TemplateName } from "../../emails/payloads";
import { paletteFor } from "../../emails/theme";

const ref = FIXTURE_PAYLOADS.order_confirmed.ref;

describe("template registry", () => {
  it("has a schema, a fixture and a definition for every template", () => {
    const schemaNames = Object.keys(payloadSchemas).sort();
    expect(TEMPLATE_NAMES.slice().sort()).toEqual(schemaNames);
    expect(Object.keys(FIXTURE_PAYLOADS).sort()).toEqual(schemaNames);
  });

  it("classifies the audience: admin alerts vs customer mail", () => {
    const admin = TEMPLATE_NAMES.filter((t) => TEMPLATES[t].audience === "admin").sort();
    expect(admin).toEqual(["low_stock_digest", "new_contact", "new_order", "new_support_case", "outbox_failure", "payment_anomaly"]);
  });

  it.each(TEMPLATE_NAMES)("%s renders html + plain text from its fixture", async (name) => {
    const r = await renderTemplate(name, FIXTURE_PAYLOADS[name], fixtureContext());
    expect(r.subject.length).toBeGreaterThan(3);
    expect(r.subject).not.toMatch(/[\r\n]/);
    expect(r.html).toContain("<html");
    expect(r.html).toContain("Example Retail Pvt Ltd"); // legal footer from settings
    expect(r.html).toContain("grievance@example.test");
    expect(r.text.length).toBeGreaterThan(40);
    expect(r.text).toContain("Example Retail Pvt Ltd");
    for (const body of [r.html, r.text, r.subject]) {
      expect(body).not.toMatch(/undefined|\[object Object\]|NaN/);
    }
  });

  it("order_confirmed shows items, the breakdown, GST and the order ref; links to /track without a token", async () => {
    const r = await renderTemplate("order_confirmed", FIXTURE_PAYLOADS.order_confirmed, fixtureContext());
    expect(r.subject).toBe(`Order ${ref} is confirmed`);
    for (const s of [ref, "Skull Mug", "Matte black", "Tiny Cactus Sticker Pack", "WELCOME10", "₹1,257.30", "Includes GST of ₹191.79", "All prices include taxes", "Asha Rao", "Mumbai, Maharashtra 400001"]) {
      expect(r.html).toContain(s);
      expect(r.text).toContain(s);
    }
    expect(r.html).toContain("https://ifonli.example.test/track");
    expect(r.html).not.toContain("?t=");
    expect(r.html).toContain("Your invoice is attached");
  });

  it("links to the order page only when the payload carries a token", async () => {
    const r = await renderTemplate("order_confirmed", { ...FIXTURE_PAYLOADS.order_confirmed, accessToken: "tok_abcdef123456" }, fixtureContext());
    expect(r.html).toContain(`https://ifonli.example.test/orders/${ref}?t=tok_abcdef123456`);
    expect(r.html).not.toContain("/track");
  });

  it("does not claim an attachment when there is none", async () => {
    const ctx = { ...fixtureContext(), invoiceAttached: false };
    const r = await renderTemplate("order_confirmed", FIXTURE_PAYLOADS.order_confirmed, ctx);
    expect(r.html).not.toContain("attached");
  });

  it("cod_placed states the amount to keep ready", async () => {
    const r = await renderTemplate("cod_placed", FIXTURE_PAYLOADS.cod_placed, fixtureContext(null, { paymentMethod: "cod", codFeePaise: 4000 }));
    expect(r.text).toContain("₹1,257.30");
    expect(r.text).toContain("Cash on delivery fee");
    expect(r.text).toContain("Total to pay on delivery");
    expect(r.subject).toContain("pay on delivery");
  });

  it("order_shipped carries courier, AWB and the tracking link", async () => {
    const r = await renderTemplate("order_shipped", FIXTURE_PAYLOADS.order_shipped, fixtureContext());
    for (const s of ["Delhivery", "DL1234567890", "https://www.delhivery.com/track/package/DL1234567890"]) {
      expect(r.html).toContain(s);
      expect(r.text).toContain(s);
    }
  });

  it("order_shipped copes with no courier details", async () => {
    const r = await renderTemplate("order_shipped", { ref, courier: null, awb: null, trackingUrl: null }, fixtureContext());
    expect(r.html).not.toContain("Tracking number");
    expect(r.html).toContain(ref);
  });

  it("payment_failed tells the customer nothing was taken and points to the tracker without a token", async () => {
    const r = await renderTemplate("payment_failed", { ref, orderId: "0b8c5c1e-6f4a-4f3b-9d7e-1a2b3c4d5e6f" }, fixtureContext());
    expect(r.subject).toBe(`Payment not completed for order ${ref}`);
    expect(r.text).toContain(ref);
    expect(r.text).toContain("try again");
    expect(r.html).toContain("https://ifonli.example.test/track");
  });

  it("an order mail still renders when the order row is gone", async () => {
    const ctx = { ...fixtureContext(), order: undefined };
    const r = await renderTemplate("order_confirmed", FIXTURE_PAYLOADS.order_confirmed, ctx);
    expect(r.text).toContain("₹1,257.30");
  });

  it("refund and late-capture mails state the amount", async () => {
    for (const name of ["refund_initiated", "refund_processed", "payment_late_refund"] as const) {
      const r = await renderTemplate(name, FIXTURE_PAYLOADS[name], fixtureContext());
      expect(r.text).toContain("₹1,257.30");
      expect(r.text).toContain(ref);
    }
    const late = await renderTemplate("payment_late_refund", FIXTURE_PAYLOADS.payment_late_refund, fixtureContext());
    expect(late.text.toLowerCase()).toContain("sorry");
  });

  it("login_otp shows the code and never asks to share it", async () => {
    const r = await renderTemplate("login_otp", FIXTURE_PAYLOADS.login_otp, fixtureContext());
    expect(r.text).toContain("482913");
    expect(r.text).toContain("10 minutes");
    expect(r.text).toContain("Never share this code");
  });

  it("admin mails: low-stock digest lists variants, payment anomaly explains the issue", async () => {
    const low = await renderTemplate("low_stock_digest", FIXTURE_PAYLOADS.low_stock_digest, fixtureContext());
    expect(low.subject).toBe("Low stock: 3 variants need attention");
    expect(low.text).toContain("SKU-MUG-BLK");
    expect(low.text).toContain("Sold out");
    expect(low.text).toContain("2 / 5");
    const pa = await renderTemplate("payment_anomaly", FIXTURE_PAYLOADS.payment_anomaly, fixtureContext());
    expect(pa.subject).toContain("Captured amount does not match");
    expect(pa.text).toContain("pay_Example123");
    expect(pa.text).toContain("₹1,000");
    const fail = await renderTemplate("outbox_failure", FIXTURE_PAYLOADS.outbox_failure, fixtureContext());
    expect(fail.text).toContain("rate_limit_exceeded");
    expect(fail.text).toContain("order_confirmed");
  });

  it("contact_reply greets by first name, keeps the reply's line breaks, quotes the original and escapes markup", async () => {
    const r = await renderTemplate("contact_reply", FIXTURE_PAYLOADS.contact_reply, fixtureContext());
    expect(r.subject).toBe("Re: your message to IfOnli");
    expect(r.text).toContain("Hi Asha,");
    expect(r.text).toContain("Yes, we can change the address");
    expect(r.text).toContain("You wrote:");
    expect(r.text).toContain("Can I change the delivery address?");
    expect(r.html).toContain("white-space:pre-line");
    const evil = await renderTemplate("contact_reply", { name: "A", message: "<b onclick=x>hi</b>", original: null }, fixtureContext());
    expect(evil.html).not.toContain("<b onclick=x>");
    expect(evil.text).not.toContain("You wrote:");
  });

  it("escapes markup in free text (contact message, support note)", async () => {
    const r = await renderTemplate("new_contact", { ...FIXTURE_PAYLOADS.new_contact, message: "<script>alert(1)</script>" }, fixtureContext());
    expect(r.html).not.toContain("<script>alert(1)</script>");
    expect(r.html).toContain("&lt;script&gt;");
  });
});

describe("payload schemas", () => {
  it("accept the payloads the existing flows write", () => {
    const orderId = "0b8c5c1e-6f4a-4f3b-9d7e-1a2b3c4d5e6f";
    // payments.ts / admin orders.ts / refunds.ts shapes
    expect(() => payloadSchemas.order_confirmed.parse({ ref, orderId, totalPaise: 100, paymentMethod: "razorpay", late: false })).not.toThrow();
    expect(() => payloadSchemas.new_order.parse({ ref, orderId, totalPaise: 100, paymentMethod: "razorpay", late: true })).not.toThrow();
    expect(() => payloadSchemas.order_shipped.parse({ ref, orderId, courier: "X", awb: null, trackingUrl: null, resent: true })).not.toThrow();
    expect(() => payloadSchemas.refund_initiated.parse({ ref, refundId: "uuid", amountPaise: 10 })).not.toThrow();
    expect(() => payloadSchemas.payment_anomaly.parse({ kind: "refund_failed", ref, refundId: "r", amountPaise: 5 })).not.toThrow();
  });

  const bad: [TemplateName, unknown][] = [
    ["order_confirmed", { totalPaise: 100, paymentMethod: "razorpay" }],
    ["order_confirmed", { ref, totalPaise: -1, paymentMethod: "razorpay" }],
    ["order_confirmed", { ref, totalPaise: 10.5, paymentMethod: "razorpay" }],
    ["order_confirmed", { ref, totalPaise: 10, paymentMethod: "upi" }],
    ["order_shipped", { ref, courier: "X", awb: "1", trackingUrl: "javascript:alert(1)" }],
    ["order_shipped", { ref, courier: "X", awb: "1", trackingUrl: "not a url" }],
    ["refund_processed", { ref, amountPaise: 5 }],
    ["login_otp", { otp: "abc", type: "sign-in", expiresMinutes: 10 }],
    ["support_case_update", { ref, caseId: "c", status: "weird" }],
    ["low_stock_digest", { total: 1, rows: [{ sku: "A" }] }],
    ["new_order", null],
  ];
  it.each(bad)("%s rejects %j", async (name, payload) => {
    expect(() => payloadSchemas[name].parse(payload)).toThrow(ZodError);
    await expect(renderTemplate(name, payload, fixtureContext())).rejects.toBeInstanceOf(ZodError);
  });

  it("an unknown template fails loudly", async () => {
    await expect(renderTemplate("nope", {}, fixtureContext())).rejects.toBeInstanceOf(UnknownTemplateError);
  });
});

describe("subject lines", () => {
  it("are single-line and bounded even for hostile input", () => {
    expect(oneLine("Hello\r\nBcc: evil@example.com  \t world")).toBe("Hello Bcc: evil@example.com world");
    expect(oneLine("x".repeat(500))).toHaveLength(200);
  });

  it("strip header injection from a contact name", async () => {
    const r = await renderTemplate("new_contact", { ...FIXTURE_PAYLOADS.new_contact, name: "Eve\r\nBcc: x@y.z" }, fixtureContext());
    expect(r.subject).toBe("New contact message from Eve Bcc: x@y.z");
  });
});

describe("palette", () => {
  it.each(VIBES)("%s uses the vibe tokens", (v) => {
    const p = paletteFor(v);
    expect(p.bg).toBe(vibes[v].palette.bg);
    expect(p.accent).toBe(vibes[v].palette.accent);
    expect(p.onAccent).toBe(vibes[v].palette["on-accent"]);
  });

  it("falls back to the neutral base for null, unknown or old values", () => {
    const base = paletteFor(null);
    expect(paletteFor("not-a-vibe")).toEqual(base);
    expect(paletteFor(undefined)).toEqual(base);
    expect(base.bg).toBe("#FFFFFF");
    expect(base).not.toEqual(paletteFor("gothic"));
  });

  it("themes the html with the order's vibe", async () => {
    const gothic = await renderTemplate("order_delivered", FIXTURE_PAYLOADS.order_delivered, fixtureContext("gothic"));
    expect(gothic.html).toContain(vibes.gothic.palette.bg!);
    expect(gothic.html).toContain(vibes.gothic.palette.accent!);
    const neutral = await renderTemplate("order_delivered", FIXTURE_PAYLOADS.order_delivered, fixtureContext(null));
    expect(neutral.html).not.toContain(vibes.gothic.palette.bg!);
  });
});
