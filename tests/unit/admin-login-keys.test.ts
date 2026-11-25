import { describe, expect, it } from "vitest";

import { mergeRecipients, truncateUserAgent, USER_AGENT_MAX } from "@/server/auth/alert-helpers";
import { adminLoginKeys, keyDigest, normaliseEmail } from "@/server/auth/login-keys";

describe("adminLoginKeys", () => {
  it("never holds the raw e-mail address, in any key", () => {
    const keys = adminLoginKeys("Owner@IfOnli.in");
    for (const key of Object.values(keys)) {
      expect(key.toLowerCase()).not.toContain("owner");
      expect(key.toLowerCase()).not.toContain("ifonli");
      expect(key).not.toContain("@");
    }
  });

  it("is the same for any letter case and surrounding spaces, and differs per address", () => {
    expect(adminLoginKeys("  Boss@Example.com ")).toEqual(adminLoginKeys("boss@example.com"));
    expect(adminLoginKeys("boss@example.com").failures).not.toBe(adminLoginKeys("other@example.com").failures);
  });

  it("uses distinct keys for the three budgets, all under admin-login-", () => {
    const { attempts, failures, lockedAlert } = adminLoginKeys("boss@example.com");
    expect(new Set([attempts, failures, lockedAlert]).size).toBe(3);
    for (const key of [attempts, failures, lockedAlert]) expect(key.startsWith("admin-login-")).toBe(true);
    // The e2e helper empties `admin-%`, the owner's unlock deletes `admin-login-%`.
    expect(failures).toMatch(/^admin-login-fail:[0-9a-f]{24}$/);
  });

  it("matches the digest the OTP guards use (sha256, first 24 hex characters)", () => {
    expect(keyDigest("a")).toBe("ca978112ca1bbdcafac231b3"); // sha256("a") = ca978112ca1bbdcafac231b39a23dc4d...
    expect(normaliseEmail("  A@B.C ")).toBe("a@b.c");
  });
});

describe("truncateUserAgent", () => {
  it("cuts to 200 characters", () => {
    expect(truncateUserAgent("x".repeat(500))).toHaveLength(USER_AGENT_MAX);
    expect(USER_AGENT_MAX).toBe(200);
    expect(truncateUserAgent("Mozilla/5.0")).toBe("Mozilla/5.0");
  });

  it("strips line breaks and control characters (they would break a header or a log line)", () => {
    expect(truncateUserAgent("Mozilla/5.0\r\nBcc: evil@example.com\u0000 x")).toBe("Mozilla/5.0 Bcc: evil@example.com x");
  });

  it("returns null for nothing", () => {
    expect(truncateUserAgent(null)).toBeNull();
    expect(truncateUserAgent(undefined)).toBeNull();
    expect(truncateUserAgent("  \r\n ")).toBeNull();
  });
});

describe("mergeRecipients", () => {
  it("lower-cases, de-duplicates across lists and keeps first-seen order", () => {
    expect(mergeRecipients(["Ops@IfOnli.in", "owner@ifonli.in"], ["OWNER@ifonli.in", "new@ifonli.in"])).toEqual([
      "ops@ifonli.in",
      "owner@ifonli.in",
      "new@ifonli.in",
    ]);
  });

  it("drops blanks and null", () => {
    expect(mergeRecipients(["", "  ", null, undefined, "a@b.co"], [])).toEqual(["a@b.co"]);
    expect(mergeRecipients()).toEqual([]);
  });
});
