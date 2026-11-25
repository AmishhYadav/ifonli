import { describe, expect, it } from "vitest";

import {
  COD_ORDERS_PER_DAY,
  ORDERS_PER_DAY,
  contactBudgets,
  contactLimitsRelaxed,
} from "@/server/services/commerce/contact-limits";

describe("contactBudgets", () => {
  const contact = { email: "Asha@Example.com ", phone: "+919876543210" };

  it("counts a prepaid order against the overall budget of the e-mail and of the phone", () => {
    const budgets = contactBudgets({ ...contact, paymentMethod: "razorpay" });
    expect(budgets).toHaveLength(2);
    expect(budgets.map((b) => b.rule)).toEqual([
      { limit: ORDERS_PER_DAY, windowSeconds: 86_400 },
      { limit: ORDERS_PER_DAY, windowSeconds: 86_400 },
    ]);
  });

  it("counts a COD order against the overall AND the COD budget of both", () => {
    const budgets = contactBudgets({ ...contact, paymentMethod: "cod" });
    expect(budgets).toHaveLength(4);
    expect(budgets.filter((b) => b.key.startsWith("order-cod:")).map((b) => b.rule.limit)).toEqual([
      COD_ORDERS_PER_DAY,
      COD_ORDERS_PER_DAY,
    ]);
    expect(ORDERS_PER_DAY).toBe(5);
    expect(COD_ORDERS_PER_DAY).toBe(3);
  });

  it("keys are digests of the normalised contact: no raw e-mail or number, case-insensitive e-mail", () => {
    const a = contactBudgets({ ...contact, paymentMethod: "cod" });
    const b = contactBudgets({ email: "asha@example.com", phone: "+919876543210", paymentMethod: "cod" });
    expect(a.map((x) => x.key)).toEqual(b.map((x) => x.key));
    for (const { key } of a) {
      expect(key).toMatch(/^order(-cod)?:(email|phone):[0-9a-f]{16}$/);
      expect(key.toLowerCase()).not.toContain("asha");
      expect(key).not.toContain("9876543210");
    }
  });

  it("a different e-mail or phone gets different keys", () => {
    const a = contactBudgets({ ...contact, paymentMethod: "razorpay" }).map((x) => x.key);
    const other = contactBudgets({ email: "b@example.com", phone: "+919000000001", paymentMethod: "razorpay" }).map(
      (x) => x.key,
    );
    expect(a.filter((k) => other.includes(k))).toEqual([]);
  });

  it("returns the keys in one fixed order whatever the input, so concurrent checkouts lock rows alike", () => {
    const keys = contactBudgets({ ...contact, paymentMethod: "cod" }).map((x) => x.key);
    expect(keys).toEqual([...keys].sort());
    // The same phone with another e-mail still takes its shared rows in sorted order.
    const keys2 = contactBudgets({ email: "z@example.com", phone: contact.phone, paymentMethod: "cod" }).map(
      (x) => x.key,
    );
    expect(keys2).toEqual([...keys2].sort());
  });
});

describe("contactLimitsRelaxed", () => {
  it("is off by default and in plain test/development runs", () => {
    expect(contactLimitsRelaxed({})).toBe(false);
    expect(contactLimitsRelaxed({ NODE_ENV: "development" })).toBe(false);
    expect(contactLimitsRelaxed({ NODE_ENV: "test" })).toBe(false);
    expect(contactLimitsRelaxed({ NODE_ENV: "development", E2E_MOCK_CHECKOUT: "0" })).toBe(false);
  });

  it("is relaxed only outside production with E2E_MOCK_CHECKOUT=1", () => {
    expect(contactLimitsRelaxed({ NODE_ENV: "development", E2E_MOCK_CHECKOUT: "1" })).toBe(true);
    expect(contactLimitsRelaxed({ NODE_ENV: "test", E2E_MOCK_CHECKOUT: "1" })).toBe(true);
  });

  it("can never be relaxed in production", () => {
    expect(contactLimitsRelaxed({ NODE_ENV: "production", E2E_MOCK_CHECKOUT: "1" })).toBe(false);
  });
});
