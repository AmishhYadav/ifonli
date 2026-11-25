import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";

const get = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`https://shop.example.test${path}`, { headers });
const withSession = { cookie: "ifonli.session_token=abc" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("proxy without ADMIN_ALLOWED_IPS (filter off)", () => {
  it("keeps the cookie redirect for admin pages and lets the login page through", () => {
    const res = proxy(get("/admin/orders", { "x-forwarded-for": "198.51.100.1" }));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin/login");
    expect(proxy(get("/admin/login")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(get("/admin/orders", withSession)).headers.get("x-middleware-next")).toBe("1");
  });

  it("does not redirect /api/admin (route handlers enforce requireAdmin themselves)", () => {
    const res = proxy(get("/api/admin/orders/export"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("proxy with ADMIN_ALLOWED_IPS", () => {
  const ALLOWED = "203.0.113.7, 198.51.100.0/24, 2001:db8::1";

  it("answers a plain 404 (no redirect, no login page) to an address outside the list, for pages and API", async () => {
    vi.stubEnv("ADMIN_ALLOWED_IPS", ALLOWED);
    for (const path of ["/admin", "/admin/login", "/admin/orders", "/api/admin/orders/export", "/api/admin"]) {
      const res = proxy(get(path, { "x-forwarded-for": "192.0.2.50", ...withSession }));
      expect(res.status, path).toBe(404);
      expect(res.headers.get("location"), path).toBeNull();
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(await res.text()).toBe("Not Found");
    }
  });

  it("lets an allowed address through: pages keep the cookie rule, the API gets only the IP filter", () => {
    vi.stubEnv("ADMIN_ALLOWED_IPS", ALLOWED);
    const ip = { "x-forwarded-for": "198.51.100.77, 10.0.0.1" };
    expect(proxy(get("/admin/orders", ip)).status).toBe(307); // no session cookie: login redirect
    expect(proxy(get("/admin/orders", { ...ip, ...withSession })).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(get("/api/admin/orders/export", ip)).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(get("/admin/login", { "x-forwarded-for": "2001:db8::1" })).headers.get("x-middleware-next")).toBe("1");
  });

  it("uses only the FIRST x-forwarded-for entry (a spoofed tail does not help), falling back to x-real-ip", () => {
    vi.stubEnv("ADMIN_ALLOWED_IPS", ALLOWED);
    expect(proxy(get("/admin/login", { "x-forwarded-for": "192.0.2.50, 203.0.113.7" })).status).toBe(404);
    expect(proxy(get("/admin/login", { "x-real-ip": "203.0.113.7" })).status).toBe(200);
  });

  it("refuses a request with no usable client address (fail closed)", () => {
    vi.stubEnv("ADMIN_ALLOWED_IPS", ALLOWED);
    expect(proxy(get("/admin/login")).status).toBe(404);
    expect(proxy(get("/admin/login", { "x-forwarded-for": "garbage" })).status).toBe(404);
  });

  it("refuses everyone when the value cannot be parsed", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("ADMIN_ALLOWED_IPS", "203.0.113.7, not-an-ip");
    expect(proxy(get("/admin/login", { "x-forwarded-for": "203.0.113.7" })).status).toBe(404);
  });

  it("follows the variable when it changes (the parse cache is keyed by value)", () => {
    vi.stubEnv("ADMIN_ALLOWED_IPS", "203.0.113.7");
    expect(proxy(get("/admin/login", { "x-forwarded-for": "198.51.100.1" })).status).toBe(404);
    vi.stubEnv("ADMIN_ALLOWED_IPS", "198.51.100.1");
    expect(proxy(get("/admin/login", { "x-forwarded-for": "198.51.100.1" })).status).toBe(200);
    vi.stubEnv("ADMIN_ALLOWED_IPS", "");
    expect(proxy(get("/admin/login", { "x-forwarded-for": "192.0.2.9" })).status).toBe(200);
  });
});
