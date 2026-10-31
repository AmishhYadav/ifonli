import { describe, expect, it } from "vitest";

import { buildEnvelope, buildEvent, captureException, parseDsn } from "@/lib/monitoring/sentry";
import { parseStack, scrubText, scrubUrl, shortenFilename } from "@/lib/monitoring/scrub";
import { stripUrl, summariseCspReports } from "@/server/security/csp-report";

describe("scrubText", () => {
  it("removes emails and phone numbers", () => {
    const out = scrubText(
      "Failed for riya.sharma+test@example.co.in call +91 98765 43210 or 9876543210 or 098765-43210",
    );
    expect(out).not.toMatch(/riya|example|98765|43210/);
    expect(out).toContain("[email]");
    expect(out).toContain("[phone]");
  });

  it("removes order tokens, bearer tokens and long opaque ids", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9abcdefghijklmnop.signaturepart1234567890";
    const out = scrubText(
      `GET /orders/IFO-2611-7K3Q?t=${token}&x=1 Authorization: Bearer abc.def-ghi cart 3f2b8c1e-aaaa-bbbb-cccc-1234567890ab`,
    );
    expect(out).not.toContain(token);
    expect(out).toContain("t=[token]");
    expect(out).toContain("Bearer [token]");
    expect(out).not.toContain("3f2b8c1e");
  });

  it("drops bound query parameters and connection strings", () => {
    const failed = scrubText(
      'Failed query: insert into "orders" ("email") values ($1) params: buyer@example.com,Flat 4 MG Road',
    );
    expect(failed).not.toContain("buyer");
    expect(failed).not.toContain("MG Road");
    expect(
      scrubText("connect postgresql://postgres:secret@db.example.com:5432/postgres failed"),
    ).toBe("connect [url] failed");
  });

  it("masks pincodes and truncates long messages", () => {
    expect(scrubText("Delivery to 400001 failed")).toBe("Delivery to [pin] failed");
    expect(scrubText("x".repeat(500)).length).toBeLessThanOrEqual(303);
  });

  it("leaves ordinary text alone", () => {
    expect(scrubText("Cannot read properties of undefined (reading 'map')")).toBe(
      "Cannot read properties of undefined (reading 'map')",
    );
  });
});

describe("scrubUrl", () => {
  it("keeps parameter names but not values and masks order refs", () => {
    expect(scrubUrl("/orders/IFO-2611-7K3Q?t=secret&vibe=gothic#frag")).toBe(
      "/orders/[ref]?t=[v]&vibe=[v]",
    );
    expect(scrubUrl("/api/orders/IFO-2611-7K3Q/invoice?t=abc")).toBe(
      "/api/orders/[ref]/invoice?t=[v]",
    );
    expect(scrubUrl("/shop")).toBe("/shop");
  });
});

describe("stack parsing", () => {
  it("parses V8 frames oldest first and drops machine paths", () => {
    const stack = [
      "Error: boom",
      "    at doThing (/home/runner/work/ifonli/.next/server/chunks/ssr/app_page.js:10:20)",
      "    at /var/task/node_modules/react/index.js:5:6",
    ].join("\n");
    const frames = parseStack(stack);
    expect(frames).toHaveLength(2);
    expect(frames[0]?.filename).toBe("node_modules/react/index.js");
    expect(frames[0]?.in_app).toBe(false);
    expect(frames[1]).toMatchObject({
      filename: ".next/server/chunks/ssr/app_page.js",
      function: "doThing",
      lineno: 10,
      colno: 20,
      in_app: true,
    });
  });

  it("shortens browser URLs", () => {
    expect(shortenFilename("https://ifonli.in/_next/static/chunks/a.js?v=1")).toBe(
      "_next/static/chunks/a.js",
    );
  });
});

describe("parseDsn", () => {
  it("parses a Sentry DSN into the envelope endpoint", () => {
    const dsn = parseDsn("https://abc123@o1.ingest.sentry.io/456789");
    expect(dsn?.envelopeUrl).toBe("https://o1.ingest.sentry.io/api/456789/envelope/");
    expect(dsn?.publicKey).toBe("abc123");
  });
  it("returns null for missing or invalid values", () => {
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn("")).toBeNull();
    expect(parseDsn("nope")).toBeNull();
    expect(parseDsn("https://o1.ingest.sentry.io/456")).toBeNull();
    expect(parseDsn("https://k@o1.ingest.sentry.io/notanumber")).toBeNull();
  });
});

describe("buildEvent / buildEnvelope", () => {
  const env = {
    dsn: "https://abc@o1.ingest.sentry.io/1",
    release: "deadbeef",
    environment: "production",
  };

  it("tags the release and environment and scrubs message, url and tags", () => {
    const error = new Error("Order for buyer@example.com to 9876543210 failed");
    const event = buildEvent(
      error,
      {
        source: "action",
        route: "/orders/[ref]",
        url: "/orders/IFO-1?t=tok",
        method: "POST",
        digest: "123456",
        tags: { who: "buyer@example.com" },
      },
      env,
    );
    const json = JSON.stringify(event);
    expect(event.release).toBe("deadbeef");
    expect(event.environment).toBe("production");
    expect(event.tags["digest"]).toBe("123456");
    expect(event.request?.url).toBe("/orders/[ref]?t=[v]");
    expect(json).not.toMatch(/buyer@|9876543210|IFO-1|tok"/);
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("never includes cookies, headers, bodies or a user", () => {
    const json = JSON.stringify(buildEvent(new Error("x"), { source: "route" }, env));
    for (const key of ['"user"', '"cookies"', '"headers"', '"data"', '"extra"'])
      expect(json).not.toContain(key);
  });

  it("builds a three-line envelope", () => {
    const event = buildEvent(new Error("x"), { source: "route" }, env);
    const lines = buildEnvelope(event, "https://abc@o1.ingest.sentry.io/1").split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[1] ?? "")).toEqual({ type: "event" });
    expect(JSON.parse(lines[2] ?? "").event_id).toBe(event.event_id);
  });
});

describe("captureException", () => {
  it("does nothing without a DSN", async () => {
    expect(await captureException(new Error("x"), { source: "route" }, "node", {})).toBe(false);
  });

  it("never throws when the network is down", async () => {
    const result = await captureException(
      new Error("unreachable-test"),
      { source: "route" },
      "node",
      { dsn: "http://k@127.0.0.1:1/1" },
    );
    expect(result).toBe(false);
  });
});

describe("CSP report summaries", () => {
  it("handles the legacy report-uri format and strips queries", () => {
    const [report] = summariseCspReports({
      "csp-report": {
        "document-uri": "https://ifonli.in/orders/IFO-1?t=secret",
        "violated-directive": "script-src-elem",
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://evil.example/x.js?token=abc",
        "source-file": "https://ifonli.in/_next/static/a.js",
        "line-number": 12,
        disposition: "report",
      },
    });
    expect(report).toEqual({
      directive: "script-src-elem",
      blocked: "https://evil.example/x.js",
      page: "/orders/IFO-1",
      source: "https://ifonli.in/_next/static/a.js",
      line: 12,
      disposition: "report",
    });
  });

  it("handles the Reporting API format and ignores other report types", () => {
    const reports = summariseCspReports([
      { type: "deprecation", body: { id: "x" } },
      {
        type: "csp-violation",
        body: {
          documentURL: "https://ifonli.in/",
          effectiveDirective: "img-src",
          blockedURL: "inline",
          disposition: "enforce",
        },
      },
    ]);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      directive: "img-src",
      blocked: "inline",
      page: "/",
      disposition: "enforce",
    });
  });

  it("caps the number of reports and survives garbage", () => {
    expect(summariseCspReports("nope")).toEqual([]);
    expect(summariseCspReports(null)).toEqual([]);
    const many = Array.from({ length: 50 }, () => ({
      type: "csp-violation",
      body: { effectiveDirective: "img-src" },
    }));
    expect(summariseCspReports(many)).toHaveLength(10);
    expect(stripUrl("data:text/plain;base64,AAAA")).toBe("data");
  });
});
