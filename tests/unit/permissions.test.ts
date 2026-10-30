import { describe, expect, it } from "vitest";

import {
  ADMIN_ROLES,
  ROLES,
  ROLE_PERMISSIONS,
  STATEMENTS,
  assertCan,
  can,
  type Permission,
} from "@/server/auth/permissions";

const allPermissions = Object.entries(STATEMENTS).flatMap(([resource, actions]) =>
  actions.map((a) => `${resource}:${a}` as Permission),
);

describe("can()", () => {
  it("owner holds every permission", () => {
    for (const p of allPermissions) expect(can("owner", p), p).toBe(true);
  });

  it("admin holds everything except users, sessions, settings and policy publishing", () => {
    const denied = allPermissions.filter((p) => !can("admin", p));
    expect(denied.sort()).toEqual(
      allPermissions
        .filter(
          (p) =>
            p.startsWith("user:") ||
            p.startsWith("session:") ||
            p.startsWith("setting:") ||
            p === "policy:publish",
        )
        .sort(),
    );
    expect(can("admin", "product:update")).toBe(true);
    expect(can("admin", "order:refund")).toBe(true);
    expect(can("admin", "policy:edit")).toBe(true);
    expect(can("admin", "report:view")).toBe(true);
  });

  it("fulfilment only handles orders (no money / catalogue) and support", () => {
    const granted = allPermissions.filter((p) => can("fulfilment", p)).sort();
    expect(granted).toEqual(
      [
        "order:view",
        "order:update_fulfilment",
        "order:add_shipment",
        "order:invoice",
        "order:packing_slip",
        "order:note",
        "support:view",
        "support:respond",
      ].sort(),
    );
    for (const p of [
      "product:view",
      "inventory:view",
      "coupon:view",
      "setting:view",
      "report:view",
      "order:refund",
      "order:cancel",
    ] as const) {
      expect(can("fulfilment", p), p).toBe(false);
    }
  });

  it("customer and unknown roles hold nothing", () => {
    for (const p of allPermissions) {
      expect(can("customer", p)).toBe(false);
      expect(can("hacker", p)).toBe(false);
      expect(can(null, p)).toBe(false);
      expect(can(undefined, p)).toBe(false);
    }
  });

  it("assertCan throws on missing permission", () => {
    expect(() => assertCan("fulfilment", "order:refund")).toThrow(/Forbidden/);
    expect(() => assertCan("owner", "order:refund")).not.toThrow();
  });

  it("matrix is well-formed", () => {
    expect([...ROLES]).toEqual(["owner", "admin", "fulfilment", "customer"]);
    expect([...ADMIN_ROLES]).toEqual(["owner", "admin", "fulfilment"]);
    for (const role of ROLES) {
      for (const [resource, actions] of Object.entries(ROLE_PERMISSIONS[role])) {
        for (const a of (actions ?? []) as readonly string[]) {
          expect((STATEMENTS as Record<string, readonly string[]>)[resource]).toContain(a);
        }
      }
    }
  });
});
