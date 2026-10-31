import { describe, expect, it } from "vitest";

import {
  buildBaselinePolicy,
  buildContentSecurityPolicy,
  buildPermissionsPolicy,
  buildSecurityHeaders,
  originOf,
  resolveCspMode,
} from "@/lib/security/headers";

const base = { production: true, siteUrl: "https://ifonli.in" } as const;

function header(headers: { key: string; value: string }[], key: string) {
  return headers.find((h) => h.key === key)?.value;
}

function directive(policy: string, name: string): string[] {
  const part = policy
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name} `) || p === name);
  return part ? part.split(/\s+/).slice(1) : [];
}

describe("resolveCspMode", () => {
  it("defaults to report-only and only enforces on an explicit value", () => {
    expect(resolveCspMode(undefined)).toBe("report-only");
    expect(resolveCspMode("")).toBe("report-only");
    expect(resolveCspMode("nonsense")).toBe("report-only");
    expect(resolveCspMode("enforce")).toBe("enforce");
    expect(resolveCspMode(" ENFORCE ")).toBe("enforce");
  });
});

describe("originOf", () => {
  it("returns the origin of http(s) URLs and null for anything else", () => {
    expect(originOf("https://abc.supabase.co/storage/v1")).toBe("https://abc.supabase.co");
    expect(originOf("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321");
    expect(originOf("")).toBeNull();
    expect(originOf(undefined)).toBeNull();
    expect(originOf("not a url")).toBeNull();
    expect(originOf("javascript:alert(1)")).toBeNull();
  });
});

describe("buildContentSecurityPolicy", () => {
  const csp = buildContentSecurityPolicy({ ...base, supabaseUrl: "https://abc.supabase.co" });

  it("is locked down by default", () => {
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("never allows eval in production but does in development", () => {
    expect(directive(csp, "script-src")).not.toContain("'unsafe-eval'");
    const dev = buildContentSecurityPolicy({ production: false });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws://localhost:*");
    expect(dev).not.toContain("upgrade-insecure-requests");
    expect(directive(csp, "connect-src").some((s) => s.startsWith("ws:"))).toBe(false);
  });

  it("allows Razorpay Checkout.js, its frames and its API", () => {
    expect(directive(csp, "script-src")).toContain("https://checkout.razorpay.com");
    expect(directive(csp, "frame-src")).toEqual(
      expect.arrayContaining(["https://api.razorpay.com", "https://checkout.razorpay.com"]),
    );
    expect(directive(csp, "connect-src")).toContain("https://api.razorpay.com");
    expect(directive(csp, "img-src")).toContain("https://cdn.razorpay.com");
  });

  it("allows the Supabase storage origin for images, media and direct uploads", () => {
    expect(directive(csp, "img-src")).toContain("https://abc.supabase.co");
    expect(directive(csp, "media-src")).toContain("https://abc.supabase.co");
    // Admin images and support photos are PUT from the browser to signed upload URLs.
    expect(directive(csp, "connect-src")).toContain("https://abc.supabase.co");
  });

  it("does not open connect-src to Supabase when it is not configured", () => {
    const none = buildContentSecurityPolicy({ ...base, supabaseUrl: undefined });
    expect(directive(none, "connect-src").some((v) => v.includes("supabase"))).toBe(false);
  });

  it("always allows the Google Analytics origins, so a GA4 id saved in admin settings works", () => {
    // No NEXT_PUBLIC_GA4_ID at build: the id can still come from the admin setting at request time.
    expect(directive(csp, "script-src")).toContain("https://www.googletagmanager.com");
    expect(directive(csp, "connect-src")).toContain("https://www.google-analytics.com");
    expect(directive(csp, "img-src")).toContain("https://www.google-analytics.com");
    const withEnv = buildContentSecurityPolicy({ ...base, ga4Id: "G-ABC123" });
    expect(withEnv).toBe(buildContentSecurityPolicy(base));
  });

  it("does not upgrade insecure requests on an http site (local next start)", () => {
    expect(
      buildContentSecurityPolicy({ production: true, siteUrl: "http://localhost:3107" }),
    ).not.toContain("upgrade-insecure-requests");
  });

  it("ships violation reports to the report endpoint", () => {
    expect(csp).toContain("report-uri /api/csp-report");
    expect(csp).toContain("report-to csp");
  });
});

describe("buildSecurityHeaders", () => {
  it("report-only mode enforces only the baseline and reports the full policy", () => {
    const headers = buildSecurityHeaders({ ...base, mode: undefined });
    expect(header(headers, "Content-Security-Policy")).toBe(buildBaselinePolicy());
    expect(header(headers, "Content-Security-Policy-Report-Only")).toContain("script-src");
    expect(header(headers, "Reporting-Endpoints")).toBe('csp="/api/csp-report"');
  });

  it("enforce mode enforces the full policy and drops the report-only header", () => {
    const headers = buildSecurityHeaders({ ...base, mode: "enforce" });
    expect(header(headers, "Content-Security-Policy")).toContain("script-src");
    expect(header(headers, "Content-Security-Policy-Report-Only")).toBeUndefined();
  });

  it("sets the standard hardening headers", () => {
    const headers = buildSecurityHeaders(base);
    expect(header(headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(header(headers, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header(headers, "X-Frame-Options")).toBe("DENY");
    expect(header(headers, "Cross-Origin-Opener-Policy")).toBe("same-origin-allow-popups");
    expect(header(headers, "Permissions-Policy")).toBe(buildPermissionsPolicy());
  });

  it("sends HSTS in production only", () => {
    expect(header(buildSecurityHeaders({ production: true }), "Strict-Transport-Security")).toMatch(
      /^max-age=\d+; includeSubDomains$/,
    );
    expect(
      header(buildSecurityHeaders({ production: false }), "Strict-Transport-Security"),
    ).toBeUndefined();
  });
});

describe("buildPermissionsPolicy", () => {
  it("turns camera, microphone and geolocation off and scopes payment to Razorpay", () => {
    const policy = buildPermissionsPolicy();
    expect(policy).toContain("camera=()");
    expect(policy).toContain("microphone=()");
    expect(policy).toContain("geolocation=()");
    expect(policy).toContain(
      'payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com")',
    );
  });
});
