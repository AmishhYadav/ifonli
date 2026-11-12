import { describe, expect, it, vi } from "vitest";

import { createBrevoChannel, isBrevoRetryable, parseFrom } from "@/server/notify/brevo";
import { resolveEmailChannel } from "@/server/notify/email-channel";

const msg = {
  to: "buyer@example.test",
  subject: "Order IFO-1 is confirmed",
  html: "<p>hi</p>",
  text: "hi",
  attachments: [{ filename: "Invoice.pdf", content: Buffer.from("pdf"), contentType: "application/pdf" }],
  idempotencyKey: "row-1",
};

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("Brevo channel", () => {
  it("is picked over Resend when its key is set", () => {
    expect(resolveEmailChannel({ brevoApiKey: "xkeysib-1", apiKey: "re_1", from: "IfOnli <shop@example.test>", nodeEnv: "production" }).name).toBe("brevo");
    expect(resolveEmailChannel({ apiKey: "re_1", from: "IfOnli <shop@example.test>", nodeEnv: "production" }).name).toBe("resend");
  });

  it("sends sender, recipient, both bodies and base64 attachments", async () => {
    const fetchImpl = reply(201, { messageId: "<m1@brevo>" });
    const res = await createBrevoChannel({ apiKey: "xkeysib-1", from: "IfOnli <shop@example.test>", fetchImpl }).send(msg);
    expect(res).toEqual({ ok: true, providerId: "<m1@brevo>" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-1");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      sender: { name: "IfOnli", email: "shop@example.test" },
      to: [{ email: "buyer@example.test" }],
      htmlContent: "<p>hi</p>",
      textContent: "hi",
      attachment: [{ name: "Invoice.pdf", content: Buffer.from("pdf").toString("base64") }],
    });
  });

  it("classifies failures", async () => {
    const send = (status: number, body: unknown) => createBrevoChannel({ apiKey: "k", from: "a@b.test", fetchImpl: reply(status, body) }).send(msg);
    expect(await send(400, { code: "invalid_parameter" })).toEqual({ ok: false, error: "brevo:invalid_parameter_400", retryable: false });
    expect(await send(429, {})).toMatchObject({ ok: false, retryable: true });
    const thrown = createBrevoChannel({ apiKey: "k", from: "a@b.test", fetchImpl: vi.fn(async () => { throw new TypeError("fetch failed"); }) });
    expect(await thrown.send(msg)).toEqual({ ok: false, error: "brevo:TypeError", retryable: true });
  });

  it.each([[429, true], [402, true], [500, true], [400, false], [401, false], [403, false]])("status %s retryable=%s", (s, r) => {
    expect(isBrevoRetryable(s)).toBe(r);
  });

  it("parses EMAIL_FROM", () => {
    expect(parseFrom("IfOnli <shop@example.test>")).toEqual({ name: "IfOnli", email: "shop@example.test" });
    expect(parseFrom('"If Onli" <shop@example.test>')).toEqual({ name: "If Onli", email: "shop@example.test" });
    expect(parseFrom("shop@example.test")).toEqual({ email: "shop@example.test" });
  });
});
