import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("CRON_SECRET", "notify-test-secret");

import { getDb } from "@/server/db";
import { notificationOutbox, variants } from "@/server/db/schema";
import { sendOtp } from "@/server/auth/otp-sender";
import { NotifyConfigError, type EmailChannel, type OutboundEmail, type SendResult } from "@/server/notify/channel";
import { setEmailChannelOverride } from "@/server/notify/email-channel";
import { queueLowStockDigest } from "@/server/notify/low-stock";
import { enqueueNotification } from "@/server/notify/outbox";
import { backoffMs, LEASE_MS, MAX_ATTEMPTS, processOutbox } from "@/server/notify/sender";
import { vibes as vibeTokens } from "@/features/vibe/tokens";
import { MockPaymentProvider } from "@/server/payments/mock";
import { finalizePaidOrder } from "@/server/services/payments";
import { createRefund } from "@/server/services/refunds";
import { setPaymentProvider } from "@/server/payments/registry";

import { seedCatalogFixture, type Fixture } from "./catalog-fixture";
import { configureCommerce, placeCodOrderNotified, placePaidOrder, seedCommerceReference } from "./helpers/factories";

const db = () => getDb();
const ADMIN = "owner@example.test";
let f: Fixture;
let provider: MockPaymentProvider;

/** Records every message; `plan` decides each send (default: success). */
class FakeChannel implements EmailChannel {
  readonly name = "fake";
  sent: OutboundEmail[] = [];
  calls = 0;
  constructor(
    private plan: (msg: OutboundEmail, call: number) => SendResult | Promise<SendResult> = (_m, n) => ({ ok: true, providerId: `fake-${n}` }),
  ) {}
  async send(msg: OutboundEmail): Promise<SendResult> {
    const n = ++this.calls;
    const r = await this.plan(msg, n);
    if (r.ok) this.sent.push(msg);
    return r;
  }
}

const rows = (template?: string) =>
  template
    ? db().select().from(notificationOutbox).where(eq(notificationOutbox.template, template))
    : db().select().from(notificationOutbox);

beforeEach(async () => {
  provider = new MockPaymentProvider({ deterministic: true });
  setPaymentProvider(provider);
  f = await seedCatalogFixture();
  await seedCommerceReference();
  await configureCommerce({ admin_alert_emails: [ADMIN] });
});
afterEach(() => {
  setPaymentProvider(null);
  setEmailChannelOverride(null);
});

describe("processOutbox with real flows", () => {
  it("sends the confirmation and the admin alert of a paid order, with the invoice attached", async () => {
    const { order } = await placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }], { form: { vibe: "gothic" } });
    const pending = await rows();
    expect(pending.map((r) => r.template).sort()).toEqual(["new_order", "order_confirmed"]);
    expect(pending.every((r) => r.status === "pending")).toBe(true);

    const ch = new FakeChannel();
    const res = await processOutbox(db(), { channel: ch });
    expect(res).toEqual({ claimed: 2, sent: 2, retrying: 0, failed: 0 });

    const sent = await rows();
    for (const r of sent) {
      expect(r).toMatchObject({ status: "sent", attempts: 1, lastError: null });
      expect(r.providerId).toMatch(/^fake-/);
      expect(r.sentAt).toBeInstanceOf(Date);
    }

    const confirmed = ch.sent.find((m) => m.to === "buyer@example.com")!;
    expect(confirmed.subject).toBe(`Order ${order.ref} is confirmed`);
    expect(confirmed.idempotencyKey).toBe(sent.find((r) => r.template === "order_confirmed")!.id);
    expect(confirmed.html).toContain("Skull Charm");
    expect(confirmed.html).toContain(vibeTokens.gothic.palette.bg!); // vibe_at_order palette
    expect(confirmed.html).toContain("/track"); // no token in the outbox: link to the tracker
    expect(confirmed.html).not.toContain("?t=");
    expect(confirmed.text).toContain(order.ref);
    expect(confirmed.attachments).toHaveLength(1);
    expect(confirmed.attachments![0]).toMatchObject({ contentType: "application/pdf" });
    expect(confirmed.attachments![0]!.filename).toMatch(/^Invoice-IFO-.*\.pdf$/);
    expect(confirmed.attachments![0]!.content.subarray(0, 4).toString()).toBe("%PDF");

    const admin = ch.sent.find((m) => m.to === ADMIN)!;
    expect(admin.subject).toContain(order.ref);
    expect(admin.attachments).toBeUndefined();

    // nothing left to do
    expect(await processOutbox(db(), { channel: ch })).toMatchObject({ claimed: 0 });
    expect(ch.calls).toBe(2);
  });

  it("COD checkout queues cod_placed + new_order through the order hook, and both send", async () => {
    const { order } = await placeCodOrderNotified([{ variantId: f.variants.skull!, qty: 1 }]);
    expect((await rows()).map((r) => r.template).sort()).toEqual(["cod_placed", "new_order"]);
    const ch = new FakeChannel();
    await processOutbox(db(), { channel: ch });
    const mail = ch.sent.find((m) => m.to === "buyer@example.com")!;
    expect(mail.subject).toBe(`Order ${order.ref} is placed (pay on delivery)`);
    expect(mail.text).toContain("Total to pay on delivery");
    expect(mail.text).toContain("Includes GST of");
    expect(mail.attachments).toHaveLength(1); // COD is invoiced at placement
  });

  it("refund, late-capture and anomaly rows written by the payment flows all render", async () => {
    const { order } = await placePaidOrder(provider, [{ variantId: f.variants.skull!, qty: 2 }]);
    await db().delete(notificationOutbox);
    await createRefund(db(), { orderId: order.orderId, amountPaise: 10000, reason: "test", actorId: null }, provider);
    // a duplicate capture on the paid order: auto-refund + customer mail + admin anomaly
    const dup = provider.simulatePayment(provider.orders.keys().next().value as string);
    await finalizePaidOrder(
      db(),
      order.orderId,
      { providerOrderId: dup.orderId!, providerPaymentId: dup.id, amountPaise: dup.amountPaise, method: dup.method },
      { provider },
    );
    const templates = (await rows()).map((r) => r.template);
    expect(templates).toEqual(expect.arrayContaining(["refund_processed", "payment_anomaly"]));
    const ch = new FakeChannel();
    const res = await processOutbox(db(), { channel: ch });
    expect(res).toMatchObject({ failed: 0, retrying: 0 });
    expect(res.sent).toBe(templates.length);
    const refundMail = ch.sent.find((m) => m.subject.startsWith("Refund processed"))!;
    expect(refundMail.text).toContain(order.ref);
    expect(refundMail.text).toContain("₹100");
    expect(ch.sent.find((m) => m.to === ADMIN && m.subject.startsWith("Payment issue"))).toBeDefined();
  });
});

describe("claiming", () => {
  it("never double-sends under concurrent processors (FOR UPDATE SKIP LOCKED)", async () => {
    for (let i = 0; i < 12; i++) {
      await enqueueNotification(db(), { template: "contact_ack", to: `c${i}@example.test`, payload: { name: `Person ${i}` } });
    }
    const ch = new FakeChannel(async (_m, n) => {
      await new Promise((r) => setTimeout(r, 25));
      return { ok: true, providerId: `p${n}` };
    });
    const results = await Promise.all([1, 2, 3, 4].map(() => processOutbox(db(), { channel: ch, limit: 4 })));
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(12);
    expect(ch.calls).toBe(12);
    expect(new Set(ch.sent.map((m) => m.idempotencyKey)).size).toBe(12);
    expect((await rows()).every((r) => r.status === "sent" && r.attempts === 1)).toBe(true);
  });

  it("leases claimed rows: a second pass shortly after does not pick up an in-flight row", async () => {
    await enqueueNotification(db(), { template: "contact_ack", to: "a@example.test", payload: { name: "A" } });
    const t0 = new Date();
    let inner: Awaited<ReturnType<typeof processOutbox>> | undefined;
    const ch = new FakeChannel(async () => {
      inner = await processOutbox(db(), { channel: new FakeChannel(), now: new Date(t0.getTime() + 60_000) });
      return { ok: true, providerId: "outer" };
    });
    await processOutbox(db(), { channel: ch, now: t0 });
    expect(inner).toMatchObject({ claimed: 0 });
    expect((await rows())[0]).toMatchObject({ status: "sent", providerId: "outer", attempts: 1 });
    expect(LEASE_MS).toBeGreaterThan(60_000);
  });

  it("a crashed processor's row comes back once the lease has passed", async () => {
    await enqueueNotification(db(), { template: "contact_ack", to: "a@example.test", payload: { name: "A" } });
    const t0 = new Date();
    // simulate: claimed (attempts=1, lease set) and then the process died
    await db().update(notificationOutbox).set({ attempts: 1, nextAttemptAt: new Date(t0.getTime() + LEASE_MS) });
    expect(await processOutbox(db(), { channel: new FakeChannel(), now: new Date(t0.getTime() + 1000) })).toMatchObject({ claimed: 0 });
    const ch = new FakeChannel();
    expect(await processOutbox(db(), { channel: ch, now: new Date(t0.getTime() + LEASE_MS + 1000) })).toMatchObject({ sent: 1 });
    expect((await rows())[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("respects the limit and sends oldest first", async () => {
    for (let i = 0; i < 5; i++) await enqueueNotification(db(), { template: "contact_ack", to: `c${i}@example.test`, payload: { name: "X" } });
    const ch = new FakeChannel();
    expect(await processOutbox(db(), { channel: ch, limit: 2 })).toMatchObject({ claimed: 2, sent: 2 });
    expect((await rows()).filter((r) => r.status === "pending")).toHaveLength(3);
  });
});

describe("retry, backoff and giving up", () => {
  const fail = (retryable = true): FakeChannel => new FakeChannel(() => ({ ok: false, error: "resend:rate_limit_exceeded for buyer@example.com", retryable }));

  it("backs off, retries, and finally gives up with a scrubbed error and an admin alert", async () => {
    await enqueueNotification(db(), { template: "contact_ack", to: "buyer@example.com", payload: { name: "A" } });
    const ch = fail();
    const t0 = new Date();

    let r = await processOutbox(db(), { channel: ch, now: t0 });
    expect(r).toMatchObject({ claimed: 1, retrying: 1, failed: 0 });
    let o = (await rows("contact_ack"))[0]!;
    expect(o).toMatchObject({ status: "pending", attempts: 1 });
    expect(o.nextAttemptAt.getTime()).toBe(t0.getTime() + backoffMs(1));
    expect(o.lastError).not.toContain("buyer@example.com");
    expect(o.lastError).toContain("rate_limit_exceeded");

    // not due yet
    expect(await processOutbox(db(), { channel: ch, now: new Date(t0.getTime() + backoffMs(1) - 1000) })).toMatchObject({ claimed: 0 });

    // keep going until the budget is spent
    let clock = t0.getTime();
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
      clock += backoffMs(attempt - 1) + 1000;
      r = await processOutbox(db(), { channel: ch, now: new Date(clock) });
      expect(r.claimed).toBeGreaterThanOrEqual(1);
      o = (await rows("contact_ack"))[0]!;
      expect(o.attempts).toBe(attempt);
    }
    expect(o).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(o.lastError!.length).toBeLessThanOrEqual(300);

    const alerts = await rows("outbox_failure");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ to: ADMIN, status: "pending" });
    expect(alerts[0]!.payload).toMatchObject({ template: "contact_ack", outboxId: o.id, attempts: MAX_ATTEMPTS });
    expect(JSON.stringify(alerts[0]!.payload)).not.toContain("buyer@example.com");

    // a failed row is never picked up again, and the alert is sent like any other mail
    const after = new FakeChannel();
    await processOutbox(db(), { channel: after, now: new Date(clock + 7 * 86_400_000) });
    expect(after.sent.map((m) => m.to)).toEqual([ADMIN]);
    expect(after.sent[0]!.text).toContain("contact_ack");
    expect(after.sent[0]!.text).not.toContain("buyer@example.com");
  });

  it("a permanent provider error fails at once and alerts", async () => {
    await enqueueNotification(db(), { template: "contact_ack", to: "bad@example.com", payload: { name: "A" } });
    const r = await processOutbox(db(), { channel: fail(false) });
    expect(r).toMatchObject({ failed: 1, retrying: 0 });
    expect((await rows("contact_ack"))[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect(await rows("outbox_failure")).toHaveLength(1);
  });

  it("recovers: a transient failure followed by success ends as sent with no error", async () => {
    await enqueueNotification(db(), { template: "contact_ack", to: "a@example.test", payload: { name: "A" } });
    const ch = new FakeChannel((_m, n) => (n === 1 ? { ok: false, error: "timeout", retryable: true } : { ok: true, providerId: "ok" }));
    const t0 = new Date();
    await processOutbox(db(), { channel: ch, now: t0 });
    await processOutbox(db(), { channel: ch, now: new Date(t0.getTime() + backoffMs(1) + 1) });
    expect((await rows("contact_ack"))[0]).toMatchObject({ status: "sent", attempts: 2, lastError: null, providerId: "ok" });
    expect(await rows("outbox_failure")).toHaveLength(0);
  });

  it("an adapter that throws is retried, not lost", async () => {
    await enqueueNotification(db(), { template: "contact_ack", to: "a@example.test", payload: { name: "A" } });
    const ch = new FakeChannel(() => {
      throw new Error("boom");
    });
    expect(await processOutbox(db(), { channel: ch })).toMatchObject({ retrying: 1, failed: 0 });
    expect((await rows())[0]).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("a bad payload or unknown template fails loudly (non-retryable) and alerts", async () => {
    await enqueueNotification(db(), { template: "order_confirmed", to: "a@example.test", payload: { ref: "X" } }); // no total / method
    await db().insert(notificationOutbox).values({ channel: "email", template: "nope", to: "a@example.test", payload: {} });
    const ch = new FakeChannel();
    const r = await processOutbox(db(), { channel: ch });
    expect(r).toMatchObject({ failed: 2, sent: 0 });
    expect(ch.calls).toBe(0);
    expect((await rows("outbox_failure")).length).toBe(2);
    const bad = (await rows("order_confirmed"))[0]!;
    expect(bad.lastError).toMatch(/ZodError/);
  });

  it("a failing alert does not raise another alert", async () => {
    await db().insert(notificationOutbox).values({ channel: "email", template: "outbox_failure", to: ADMIN, payload: { template: "x", outboxId: "y", attempts: 1, error: "e" } });
    await processOutbox(db(), { channel: fail(false) });
    expect(await rows("outbox_failure")).toHaveLength(1);
    expect((await rows("outbox_failure"))[0]!.status).toBe("failed");
  });

  it("whatsapp rows go to the (disabled) WhatsApp adapter, not e-mail", async () => {
    await db().insert(notificationOutbox).values({ channel: "whatsapp", template: "order_confirmed", to: "+919800000000", payload: {} });
    const ch = new FakeChannel();
    const r = await processOutbox(db(), { channel: ch });
    expect(ch.calls).toBe(0);
    expect(r).toMatchObject({ failed: 1 });
    expect((await rows("order_confirmed"))[0]!.lastError).toBe("whatsapp:disabled");
  });
});

describe("configuration", () => {
  it("production without a Resend key is a hard error and leaves the queue untouched", async () => {
    await enqueueNotification(db(), { template: "contact_ack", to: "a@example.test", payload: { name: "A" } });
    await expect(processOutbox(db(), { env: { nodeEnv: "production" } })).rejects.toBeInstanceOf(NotifyConfigError);
    expect((await rows())[0]).toMatchObject({ status: "pending", attempts: 0 });
  });
});

describe("low-stock digest", () => {
  it("queues one admin mail listing low and sold-out variants, and nothing when stock is fine", async () => {
    // fixture: cat-sticker stock 3 (low), heart red stock 0
    const res = await queueLowStockDigest(db());
    expect(res.variants).toBeGreaterThan(0);
    expect(res.recipients).toBe(1);
    const [digest] = await rows("low_stock_digest");
    expect(digest).toMatchObject({ to: ADMIN, orderId: null });

    const ch = new FakeChannel();
    await processOutbox(db(), { channel: ch });
    const mail = ch.sent[0]!;
    expect(mail.subject).toMatch(/^Low stock: \d+ variants? need attention$/);
    expect(mail.text).toContain("Sold out");
    const skus = (digest!.payload as { rows: { sku: string }[] }).rows.map((r) => r.sku);
    expect(skus.length).toBe(res.variants);
    for (const s of skus) expect(mail.text).toContain(s);

    // restock everything above its threshold: nothing to report, nothing queued
    await db().update(variants).set({ stockOnHand: 1000 });
    await db().delete(notificationOutbox);
    expect(await queueLowStockDigest(db())).toEqual({ variants: 0, recipients: 0 });
    expect(await rows()).toHaveLength(0);
  });
});

describe("cron routes", () => {
  const ROUTES = {
    "notify-retry": () => import("@/app/api/cron/notify-retry/route"),
    "low-stock-digest": () => import("@/app/api/cron/low-stock-digest/route"),
  };
  const call = async (name: "notify-retry" | "low-stock-digest", auth?: string) => {
    const { GET } = await ROUTES[name]();
    return GET(new Request(`http://localhost/api/cron/${name}`, { headers: auth ? { authorization: auth } : {} }));
  };

  it("rejects requests without the bearer secret", async () => {
    expect((await call("notify-retry")).status).toBe(401);
    expect((await call("low-stock-digest", "Bearer wrong")).status).toBe(401);
  });

  it("notify-retry sends what is due", async () => {
    await enqueueNotification(db(), { template: "contact_ack", to: "a@example.test", payload: { name: "A" } });
    const ch = new FakeChannel();
    setEmailChannelOverride(ch);
    const res = await call("notify-retry", "Bearer notify-test-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, claimed: 1, sent: 1 });
    expect(ch.calls).toBe(1);
  });

  it("low-stock-digest queues and sends the digest", async () => {
    const ch = new FakeChannel();
    setEmailChannelOverride(ch);
    const res = await call("low-stock-digest", "Bearer notify-test-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, recipients: 1, sent: 1 });
    expect(ch.sent[0]!.to).toBe(ADMIN);
  });
});

describe("OTP", () => {
  it("is sent straight through the e-mail channel (no outbox row) and carries the code", async () => {
    const ch = new FakeChannel();
    setEmailChannelOverride(ch);
    await sendOtp({ email: "buyer@example.com", otp: "123456", type: "sign-in" });
    expect(ch.sent).toHaveLength(1);
    const m = ch.sent[0]!;
    expect(m.to).toBe("buyer@example.com");
    expect(m.subject).toContain("123456");
    expect(m.html).toContain("123456");
    expect(m.text).toContain("123456");
    expect(m.text).toContain("10 minutes");
    expect(await rows()).toHaveLength(0);
  });

  it("surfaces a send failure to the caller instead of swallowing it", async () => {
    setEmailChannelOverride(new FakeChannel(() => ({ ok: false, error: "resend:invalid_api_key", retryable: false })));
    await expect(sendOtp({ email: "buyer@example.com", otp: "123456", type: "sign-in" })).rejects.toThrow(/Could not send/);
  });
});
