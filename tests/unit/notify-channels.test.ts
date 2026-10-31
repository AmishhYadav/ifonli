import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { NotifyConfigError } from "@/server/notify/channel";
import { createDevMailChannel } from "@/server/notify/dev-mail";
import { isRetryable } from "@/server/notify/email";
import { resolveEmailChannel } from "@/server/notify/email-channel";
import { backoffMs, LEASE_MS, MAX_ATTEMPTS, sanitizeError } from "@/server/notify/sender";
import { disabledWhatsAppChannel } from "@/server/notify/whatsapp";

afterEach(() => vi.restoreAllMocks());

describe("resolveEmailChannel", () => {
  it("uses Resend when a key and a from address are set", () => {
    expect(resolveEmailChannel({ apiKey: "re_test", from: "IfOnli <orders@example.test>", nodeEnv: "production" }).name).toBe("resend");
  });

  it("requires EMAIL_FROM with a key", () => {
    expect(() => resolveEmailChannel({ apiKey: "re_test", nodeEnv: "production" })).toThrow(NotifyConfigError);
  });

  it("falls back to dev-mail files without a key outside production", () => {
    expect(resolveEmailChannel({ nodeEnv: "development" }).name).toBe("dev-mail");
    expect(resolveEmailChannel({ nodeEnv: "test" }).name).toBe("dev-mail");
  });

  it("is a hard configuration error in production without a key (never a silent drop)", () => {
    expect(() => resolveEmailChannel({ nodeEnv: "production" })).toThrow(NotifyConfigError);
    expect(() => resolveEmailChannel({ nodeEnv: "production", from: "x@example.test" })).toThrow(/RESEND_API_KEY/);
  });
});

describe("dev-mail channel", () => {
  it("writes html + text files and logs only the file name", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ifonli-devmail-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await createDevMailChannel(dir).send({
        to: "buyer@example.test",
        subject: "482913 is your sign-in code",
        html: "<p>hello</p>",
        text: "hello",
        idempotencyKey: "abc-123",
      });
      expect(res.ok).toBe(true);
      const files = (await readdir(dir)).sort();
      expect(files).toHaveLength(2);
      const html = await readFile(path.join(dir, files.find((f) => f.endsWith(".html"))!), "utf8");
      expect(html).toContain("<p>hello</p>");
      expect(html).toContain("to: buyer@example.test");
      const logged = log.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain(".dev-mail/");
      expect(logged).not.toContain("buyer@example.test");
      expect(logged).not.toContain("482913");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a failed write as retryable instead of throwing", async () => {
    const res = await createDevMailChannel("/dev/null/cannot-write").send({ to: "a@b.test", subject: "s", html: "h", text: "t", idempotencyKey: "k" });
    expect(res).toMatchObject({ ok: false, retryable: true });
  });
});

describe("Resend error classification", () => {
  it.each([
    ["rate_limit_exceeded", 429, true],
    ["internal_server_error", 500, true],
    ["application_error", 500, true],
    ["concurrent_idempotent_requests", 409, true],
    ["daily_quota_exceeded", 429, true],
    ["validation_error", 422, false],
    ["invalid_from_address", 422, false],
    ["invalid_api_key", 403, false],
    ["missing_api_key", 401, false],
    ["invalid_idempotent_request", 409, false],
  ] as const)("%s (%s) retryable=%s", (name, status, retryable) => {
    expect(isRetryable(name, status)).toBe(retryable);
  });
  it("treats a network failure (no status) as retryable", () => {
    expect(isRetryable("application_error", null)).toBe(true);
  });
});

describe("whatsapp adapter", () => {
  it("is disabled by default: a permanent failure, not a silent success", async () => {
    const r = await disabledWhatsAppChannel.send({ to: "+919800000000", template: "order_confirmed", params: [], idempotencyKey: "k" });
    expect(r).toEqual({ ok: false, error: "whatsapp:disabled", retryable: false });
  });
});

describe("backoff and error hygiene", () => {
  it("backs off exponentially from 5 minutes and caps at 6 hours", () => {
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([5, 10, 20, 40, 80].map((m) => m * 60_000));
    expect(backoffMs(30)).toBe(6 * 60 * 60_000);
  });

  it("leases a claimed row longer than any single send, and tries a bounded number of times", () => {
    expect(LEASE_MS).toBeGreaterThanOrEqual(5 * 60_000);
    expect(MAX_ATTEMPTS).toBeGreaterThan(1);
  });

  it("scrubs addresses and numbers and bounds the length", () => {
    const e = sanitizeError("Invalid recipient buyer@example.com / +91 98765 43210\nfailed " + "x".repeat(500));
    expect(e).not.toContain("buyer@example.com");
    expect(e).not.toContain("98765");
    expect(e).toContain("[email]");
    expect(e).not.toContain("\n");
    expect(e.length).toBeLessThanOrEqual(300);
  });
});
