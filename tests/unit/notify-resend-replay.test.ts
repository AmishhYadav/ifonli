import { describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

const { createResendChannel } = await import("@/server/notify/email");

const msg = { to: "a@example.test", subject: "s", html: "<p>x</p>", text: "x", idempotencyKey: "row-1" };
const channel = createResendChannel({ apiKey: "re_test", from: "IfOnli <o@example.test>" });

describe("Resend adapter", () => {
  it("treats a 409 invalid_idempotent_request as already sent, with a note", async () => {
    send.mockResolvedValueOnce({ data: null, error: { name: "invalid_idempotent_request", statusCode: 409, message: "x" } });
    const r = await channel.send(msg);
    expect(r).toMatchObject({ ok: true, providerId: "resend:replay:row-1" });
    expect(r.ok && r.note).toMatch(/already sent/);
  });

  it("still fails other provider errors, and succeeds normally", async () => {
    send.mockResolvedValueOnce({ data: null, error: { name: "invalid_api_key", statusCode: 403, message: "x" } });
    expect(await channel.send(msg)).toMatchObject({ ok: false, retryable: false });
    send.mockResolvedValueOnce({ data: { id: "em_1" }, error: null });
    expect(await channel.send(msg)).toEqual({ ok: true, providerId: "em_1" });
  });
});
