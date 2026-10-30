import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createAccessToken, hashAccessToken, verifyAccessToken } from "@/server/domain";

describe("access tokens", () => {
  it("creates a 32-byte base64url token and its sha256 hex", () => {
    const { token, hash } = createAccessToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashAccessToken(token)).toBe(hash);
  });

  it("generates unique tokens", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => createAccessToken().token));
    expect(tokens.size).toBe(200);
  });

  it("round-trips", () => {
    const { token, hash } = createAccessToken();
    expect(verifyAccessToken(token, hash)).toBe(true);
    expect(verifyAccessToken(token, hash.toUpperCase())).toBe(true);
  });

  it("rejects a different token or a tampered token", () => {
    const a = createAccessToken();
    const b = createAccessToken();
    expect(verifyAccessToken(b.token, a.hash)).toBe(false);
    const flipped = (a.token[0] === "A" ? "B" : "A") + a.token.slice(1);
    expect(verifyAccessToken(flipped, a.hash)).toBe(false);
    expect(verifyAccessToken(`${a.token} `, a.hash)).toBe(false);
  });

  it("returns false (never throws) for malformed input", () => {
    const { token, hash } = createAccessToken();
    expect(verifyAccessToken("", hash)).toBe(false);
    expect(verifyAccessToken(token, "")).toBe(false);
    expect(verifyAccessToken(token, hash.slice(0, 32))).toBe(false);
    expect(verifyAccessToken(token, `${hash}00`)).toBe(false);
    expect(verifyAccessToken(token, "z".repeat(64))).toBe(false);
    expect(verifyAccessToken(undefined as unknown as string, hash)).toBe(false);
    expect(verifyAccessToken(token, null as unknown as string)).toBe(false);
  });
});
