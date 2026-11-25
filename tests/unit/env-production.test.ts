import { describe, expect, it } from "vitest";

import { assertProductionEnv, parseServerEnv, productionEnvProblems } from "@/lib/env";

const good = {
  NEXT_PUBLIC_SITE_URL: "https://ifonli.in",
  BETTER_AUTH_SECRET: "a".repeat(32),
  CRON_SECRET: "b".repeat(32),
  DATABASE_URL: "postgresql://u:p@db.example:6543/postgres",
  RESEND_API_KEY: "re_123",
  EMAIL_FROM: "IfOnli <orders@ifonli.in>",
  RAZORPAY_KEY_ID: "rzp_live_x",
  RAZORPAY_KEY_SECRET: "secret",
  RAZORPAY_WEBHOOK_SECRET: "whsec",
};

describe("productionEnvProblems", () => {
  it("accepts a complete environment", () => {
    expect(productionEnvProblems(good)).toEqual([]);
    expect(() => assertProductionEnv(good)).not.toThrow();
  });

  it("reports every missing or weak value by name, without echoing values", () => {
    const problems = productionEnvProblems({ BETTER_AUTH_SECRET: "short-secret-value", CRON_SECRET: "" });
    const text = problems.join("\n");
    for (const name of [
      "NEXT_PUBLIC_SITE_URL",
      "BETTER_AUTH_SECRET",
      "CRON_SECRET",
      "DATABASE_URL",
      "RESEND_API_KEY",
      "EMAIL_FROM",
    ]) {
      expect(text, name).toContain(name);
    }
    expect(text).not.toContain("RAZORPAY");
    expect(text).not.toContain("short-secret-value");
    expect(() => assertProductionEnv({})).toThrow(/Invalid production environment/);
  });

  it("boots with no Razorpay variables at all", () => {
    const rest: Record<string, string | undefined> = { ...good };
    delete rest.RAZORPAY_KEY_ID;
    delete rest.RAZORPAY_KEY_SECRET;
    delete rest.RAZORPAY_WEBHOOK_SECRET;
    expect(productionEnvProblems(rest)).toEqual([]);
    expect(productionEnvProblems({ ...rest, RAZORPAY_KEY_ID: "", RAZORPAY_KEY_SECRET: "  " })).toEqual([]);
  });

  it("treats Razorpay as all-or-nothing and names the missing variables", () => {
    const only = productionEnvProblems({ ...good, RAZORPAY_KEY_SECRET: "", RAZORPAY_WEBHOOK_SECRET: undefined });
    expect(only).toHaveLength(2);
    expect(only.join("\n")).toContain("RAZORPAY_KEY_SECRET");
    expect(only.join("\n")).toContain("RAZORPAY_WEBHOOK_SECRET");
    expect(only.join("\n")).not.toContain("RAZORPAY_KEY_ID is not set");
    const webhookOnly = productionEnvProblems({
      ...good,
      RAZORPAY_KEY_ID: undefined,
      RAZORPAY_KEY_SECRET: undefined,
    });
    expect(webhookOnly).toHaveLength(2);
  });

  it("treats blank values as missing", () => {
    expect(productionEnvProblems({ ...good, EMAIL_FROM: "   " })).toEqual(["EMAIL_FROM is not set"]);
  });

  it("requires an https site URL, except for localhost", () => {
    expect(productionEnvProblems({ ...good, NEXT_PUBLIC_SITE_URL: "http://ifonli.in" })).toEqual([
      "NEXT_PUBLIC_SITE_URL must be an https:// URL",
    ]);
    expect(productionEnvProblems({ ...good, NEXT_PUBLIC_SITE_URL: "not a url" })).toEqual([
      "NEXT_PUBLIC_SITE_URL is not a valid URL",
    ]);
    expect(productionEnvProblems({ ...good, NEXT_PUBLIC_SITE_URL: "http://localhost:3107" })).toEqual([]);
    expect(productionEnvProblems({ ...good, NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3107" })).toEqual([]);
  });

  it("does not require ORDER_TOKEN_SECRET", () => {
    expect(productionEnvProblems({ ...good, ORDER_TOKEN_SECRET: undefined })).toEqual([]);
  });
});

describe("ADMIN_ALLOWED_IPS", () => {
  it("is optional: unset or blank means no filtering", () => {
    expect(parseServerEnv({ DATABASE_URL: "postgres://x" }).ADMIN_ALLOWED_IPS).toBeUndefined();
    expect(parseServerEnv({ DATABASE_URL: "postgres://x", ADMIN_ALLOWED_IPS: "  " }).ADMIN_ALLOWED_IPS).toBeUndefined();
    expect(productionEnvProblems({ ...good, ADMIN_ALLOWED_IPS: "" })).toEqual([]);
  });

  it("accepts addresses and IPv4 ranges", () => {
    const value = "203.0.113.7, 198.51.100.0/24, 2001:db8::1";
    expect(parseServerEnv({ DATABASE_URL: "postgres://x", ADMIN_ALLOWED_IPS: value }).ADMIN_ALLOWED_IPS).toBe(value);
    expect(productionEnvProblems({ ...good, ADMIN_ALLOWED_IPS: value })).toEqual([]);
  });

  it("refuses a list with an entry it cannot read, naming the entry (a half-read list would lock out or let in)", () => {
    expect(() => parseServerEnv({ DATABASE_URL: "postgres://x", ADMIN_ALLOWED_IPS: "203.0.113.7, 300.1.1.1" })).toThrow(/300\.1\.1\.1/);
    expect(() => parseServerEnv({ DATABASE_URL: "postgres://x", ADMIN_ALLOWED_IPS: "0.0.0.0/0" })).toThrow(/0\.0\.0\.0\/0/);
    expect(() => parseServerEnv({ DATABASE_URL: "postgres://x", ADMIN_ALLOWED_IPS: " , " })).toThrow(/lists no address/);
    const text = productionEnvProblems({ ...good, ADMIN_ALLOWED_IPS: "203.0.113.7, nope" }).join("\n");
    expect(text).toContain("ADMIN_ALLOWED_IPS");
    expect(text).toContain("nope");
    expect(productionEnvProblems({ ...good, ADMIN_ALLOWED_IPS: " , " }).join("\n")).toContain("lists no address");
  });
});
