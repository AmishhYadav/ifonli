import { describe, expect, it } from "vitest";

import { clientIpFromHeaders, isIpAllowed, parseAllowedIps } from "@/lib/ip-allowlist";

const allowed = (list: string, ip: string | null) => {
  const { rules, invalid } = parseAllowedIps(list);
  expect(invalid, `invalid in "${list}"`).toEqual([]);
  return isIpAllowed(ip, rules);
};

describe("parseAllowedIps", () => {
  it("reads addresses and CIDR ranges, ignoring spaces and empty entries", () => {
    const { rules, invalid } = parseAllowedIps(" 203.0.113.7 , 198.51.100.0/24,, 2001:db8::1 ,");
    expect(invalid).toEqual([]);
    expect(rules).toHaveLength(3);
  });

  it("reports what it cannot read, verbatim, and keeps the rest", () => {
    const { rules, invalid } = parseAllowedIps(
      "1.2.3.4, 256.1.1.1, 1.2.3, 1.2.3.4/33, 1.2.3.4/0, 1.2.3.4/x, 01.2.3.4, 2001:db8::/32, example.com, 1.2.3.4/24/1, :::, 1:2:3:4:5:6:7:8:9, fe80::1%eth0",
    );
    expect(rules).toHaveLength(1);
    expect(invalid).toEqual([
      "256.1.1.1",
      "1.2.3",
      "1.2.3.4/33",
      "1.2.3.4/0",
      "1.2.3.4/x",
      "01.2.3.4",
      "2001:db8::/32",
      "example.com",
      "1.2.3.4/24/1",
      ":::",
      "1:2:3:4:5:6:7:8:9",
      "fe80::1%eth0",
    ]);
  });

  it("an empty or blank value lists nothing", () => {
    expect(parseAllowedIps("")).toEqual({ rules: [], invalid: [] });
    expect(parseAllowedIps(" , ,")).toEqual({ rules: [], invalid: [] });
  });
});

describe("isIpAllowed: IPv4", () => {
  it("matches a single address exactly", () => {
    expect(allowed("203.0.113.7", "203.0.113.7")).toBe(true);
    expect(allowed("203.0.113.7", "203.0.113.8")).toBe(false);
    expect(allowed("203.0.113.7", "203.0.113.70")).toBe(false);
  });

  it("matches a CIDR range including both ends and nothing outside", () => {
    expect(allowed("198.51.100.0/24", "198.51.100.0")).toBe(true);
    expect(allowed("198.51.100.0/24", "198.51.100.255")).toBe(true);
    expect(allowed("198.51.100.0/24", "198.51.101.0")).toBe(false);
    expect(allowed("198.51.100.0/24", "198.51.99.255")).toBe(false);
  });

  it("handles odd prefixes and the host bits of the base address", () => {
    expect(allowed("10.0.0.0/8", "10.255.255.255")).toBe(true);
    expect(allowed("10.0.0.0/8", "11.0.0.0")).toBe(false);
    expect(allowed("192.168.1.77/25", "192.168.1.0")).toBe(true); // base normalised to .0/25
    expect(allowed("192.168.1.77/25", "192.168.1.127")).toBe(true);
    expect(allowed("192.168.1.77/25", "192.168.1.128")).toBe(false);
    expect(allowed("203.0.113.7/32", "203.0.113.7")).toBe(true);
    expect(allowed("203.0.113.7/32", "203.0.113.6")).toBe(false);
    // The top of the range (sign bit of a 32-bit int) must not break the mask maths.
    expect(allowed("255.255.255.0/24", "255.255.255.9")).toBe(true);
    expect(allowed("128.0.0.0/1", "200.1.1.1")).toBe(true);
    expect(allowed("128.0.0.0/1", "127.255.255.255")).toBe(false);
  });

  it("any one of several entries is enough", () => {
    expect(allowed("1.1.1.1, 2.2.2.0/24, 2001:db8::1", "2.2.2.9")).toBe(true);
    expect(allowed("1.1.1.1, 2.2.2.0/24, 2001:db8::1", "3.3.3.3")).toBe(false);
  });
});

describe("isIpAllowed: IPv6", () => {
  it("matches the same address written differently", () => {
    expect(allowed("2001:db8::1", "2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(true);
    expect(allowed("2001:DB8::1", "2001:db8::1")).toBe(true);
    expect(allowed("2001:db8::1", "2001:db8::2")).toBe(false);
    expect(allowed("2001:db8:0:0:0:0:0:1", "2001:db8::1")).toBe(true);
    expect(allowed("::1", "::1")).toBe(true);
    expect(allowed("::", "::")).toBe(true);
  });

  it("does not match an IPv6 address against an IPv4 range or the other way round", () => {
    expect(allowed("10.0.0.0/8", "2001:db8::1")).toBe(false);
    expect(allowed("2001:db8::1", "10.0.0.1")).toBe(false);
  });

  it("treats an IPv4-mapped IPv6 address as the IPv4 address (both sides)", () => {
    expect(allowed("203.0.113.7", "::ffff:203.0.113.7")).toBe(true);
    expect(allowed("203.0.113.0/24", "::ffff:203.0.113.200")).toBe(true);
    expect(allowed("::ffff:203.0.113.7", "203.0.113.7")).toBe(true);
    expect(allowed("203.0.113.7", "::ffff:cb00:7107")).toBe(true); // 203.0.113.7 as hex words
    expect(allowed("203.0.113.7", "::ffff:203.0.113.8")).toBe(false);
  });
});

describe("isIpAllowed: refusals", () => {
  it("never allows a missing or unparseable address", () => {
    const { rules } = parseAllowedIps("203.0.113.0/24");
    for (const ip of [null, undefined, "", "unknown", "203.0.113", "203.0.113.7.1", "not-an-ip", "203.0.113.7, 1.1.1.1"]) {
      expect(isIpAllowed(ip, rules), String(ip)).toBe(false);
    }
  });

  it("an empty rule list allows nobody", () => {
    expect(isIpAllowed("203.0.113.7", [])).toBe(false);
  });
});

describe("clientIpFromHeaders", () => {
  const headers = (h: Record<string, string>) => ({ get: (name: string) => h[name] ?? null });

  it("takes the first x-forwarded-for entry", () => {
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" }))).toBe("203.0.113.7");
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "  203.0.113.7  " }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to null", () => {
    expect(clientIpFromHeaders(headers({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "", "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
    expect(clientIpFromHeaders(headers({}))).toBeNull();
  });
});
