import { describe, expect, it } from "vitest";

import { assertProductionEnv, productionEnvProblems } from "@/lib/env";

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
      "RAZORPAY_KEY_ID",
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
    ]) {
      expect(text, name).toContain(name);
    }
    expect(text).not.toContain("short-secret-value");
    expect(() => assertProductionEnv({})).toThrow(/Invalid production environment/);
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
