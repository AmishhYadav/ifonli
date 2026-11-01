import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/server/db";
import { notificationOutbox } from "@/server/db/schema";
import type { EmailChannel, OutboundEmail, SendResult } from "@/server/notify/channel";
import { enqueueNotification } from "@/server/notify/outbox";
import { isRetryableDeliveryError, processOutbox, RenderError } from "@/server/notify/sender";

import { loadEmailContext } from "@/server/notify/context";
import { renderTemplate } from "@/server/notify/templates";

vi.mock("@/server/notify/context", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/notify/context")>();
  return { ...mod, loadEmailContext: vi.fn(mod.loadEmailContext) };
});
vi.mock("@/server/notify/templates", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/notify/templates")>();
  return { ...mod, renderTemplate: vi.fn(mod.renderTemplate) };
});

const db = () => getDb();

class FakeChannel implements EmailChannel {
  readonly name = "fake";
  calls = 0;
  constructor(private delayMs = 0) {}
  async send(msg: OutboundEmail): Promise<SendResult> {
    void msg;
    this.calls++;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    return { ok: true, providerId: `fake-${this.calls}` };
  }
}

const queueAck = (to = "buyer@example.test") =>
  enqueueNotification(db(), { template: "contact_ack", to, payload: { name: "A" } });
const only = async () => (await db().select().from(notificationOutbox).where(eq(notificationOutbox.template, "contact_ack")))[0]!;

beforeEach(() => {
  vi.mocked(loadEmailContext).mockClear();
  vi.mocked(renderTemplate).mockClear();
});

describe("which delivery problems are retried", () => {
  it("classifies by kind: only a bad payload or a failed render is permanent", () => {
    expect(isRetryableDeliveryError(new Error("connection terminated unexpectedly"))).toBe(true);
    expect(isRetryableDeliveryError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableDeliveryError("boom")).toBe(true);
    expect(isRetryableDeliveryError(new RenderError("contact_ack", new Error("x")))).toBe(false);
  });

  it("a database or network blip while building the e-mail keeps the row pending for a retry", async () => {
    await queueAck();
    vi.mocked(loadEmailContext).mockRejectedValueOnce(new Error("connection terminated unexpectedly"));
    const ch = new FakeChannel();
    expect(await processOutbox(db(), { channel: ch })).toMatchObject({ claimed: 1, retrying: 1, failed: 0 });
    expect(await only()).toMatchObject({ status: "pending", attempts: 1 });
    expect((await only()).lastError).toMatch(/connection terminated/);
    expect(ch.calls).toBe(0);
  });

  it("a template that cannot render fails on the first attempt and alerts", async () => {
    await queueAck();
    vi.mocked(renderTemplate).mockRejectedValueOnce(new Error("bad markup"));
    expect(await processOutbox(db(), { channel: new FakeChannel() })).toMatchObject({ failed: 1, retrying: 0 });
    expect(await only()).toMatchObject({ status: "failed", attempts: 1 });
    expect((await only()).lastError).toMatch(/RenderError/);
  });
});

describe("time budget", () => {
  it("stops sending when the budget is used up and puts the rest back without costing an attempt", async () => {
    for (let i = 0; i < 3; i++) await queueAck(`c${i}@example.test`);
    const ch = new FakeChannel(60);
    const res = await processOutbox(db(), { channel: ch, budgetMs: 30 });
    expect(res).toMatchObject({ claimed: 3, sent: 1, deferred: 2 });
    expect(ch.calls).toBe(1);

    const rows = await db().select().from(notificationOutbox).where(eq(notificationOutbox.template, "contact_ack"));
    const left = rows.filter((r) => r.status === "pending");
    expect(left).toHaveLength(2);
    expect(left.every((r) => r.attempts === 0)).toBe(true);

    // The next run (no budget pressure) picks them straight up.
    expect(await processOutbox(db(), { channel: new FakeChannel() })).toMatchObject({ claimed: 2, sent: 2 });
  });

  it("does not report deferred when everything was sent", async () => {
    await queueAck();
    const res = await processOutbox(db(), { channel: new FakeChannel() });
    expect(res).toEqual({ claimed: 1, sent: 1, retrying: 0, failed: 0 });
  });
});
