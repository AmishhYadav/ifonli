import { describe, expect, it } from "vitest";

import { headline, nextSteps, paymentLine } from "@/components/orders/order-copy";
import { accountLoginUrl, safeNextPath } from "@/features/account/redirect";
import { accountAddressSchema, fieldErrorsOf, profileSchema } from "@/features/account/schema";
import {
  SUPPORT_PHOTO_MAX,
  SUPPORT_PHOTO_MAX_BYTES,
  reportableTypes,
  supportCaseSchema,
  validatePhotoFiles,
} from "@/features/orders/support-schema";

describe("safeNextPath", () => {
  it("keeps same-origin paths (with their query)", () => {
    expect(safeNextPath("/account/orders")).toBe("/account/orders");
    expect(safeNextPath("/account/orders/IFO-2611-7K3Q?x=1")).toBe("/account/orders/IFO-2611-7K3Q?x=1");
    expect(safeNextPath("/checkout")).toBe("/checkout");
  });

  it("falls back for anything that could leave the site or loop", () => {
    for (const bad of [
      "https://evil.example/phish",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "evil.example",
      "",
      "   ",
      "/ok\nLocation: x",
      "/a\u0000b",
      "/account/login",
      "/account/login?next=/x",
      "x".repeat(600),
      undefined,
      null,
      42,
    ]) {
      expect(safeNextPath(bad), String(bad)).toBe("/account");
    }
    expect(safeNextPath("https://evil.example", "/")).toBe("/");
  });

  it("builds the login url with next and a prefilled email", () => {
    expect(accountLoginUrl()).toBe("/account/login");
    expect(accountLoginUrl({ next: "/account" })).toBe("/account/login");
    expect(accountLoginUrl({ next: "/account/orders" })).toBe("/account/login?next=%2Faccount%2Forders");
    expect(accountLoginUrl({ email: "a@b.in" })).toBe("/account/login?email=a%40b.in");
    expect(accountLoginUrl({ next: "//evil.example", email: "a@b.in" })).toBe("/account/login?email=a%40b.in");
  });
});

describe("account schemas", () => {
  it("normalises the profile and never defaults the marketing opt-in to on", () => {
    const ok = profileSchema.parse({ name: "  Asha Rao ", phone: "98765 43210" });
    expect(ok).toEqual({ name: "Asha Rao", phone: "+919876543210", marketingOptIn: false });
    expect(profileSchema.parse({ name: "Asha Rao", phone: "" }).phone).toBeUndefined();
    const bad = profileSchema.safeParse({ name: "A", phone: "12345" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(Object.keys(fieldErrorsOf(bad.error)).sort()).toEqual(["name", "phone"]);
  });

  it("uses the checkout address rules plus a phone and a default flag", () => {
    const base = { name: "Asha Rao", phone: "9876543210", line1: "12 Marine Drive", city: "Mumbai", state: "Maharashtra", pincode: "400001" };
    expect(accountAddressSchema.parse(base)).toMatchObject({ phone: "+919876543210", isDefault: false });
    expect(accountAddressSchema.safeParse({ ...base, pincode: "012345" }).success).toBe(false);
    expect(accountAddressSchema.safeParse({ ...base, phone: "" }).success).toBe(false);
  });
});

describe("support report rules", () => {
  it("accepts up to four JPEG/PNG/WebP photos within the size limit", () => {
    const jpeg = { type: "image/jpeg", size: 1024 };
    expect(validatePhotoFiles([])).toBeNull();
    expect(validatePhotoFiles(Array.from({ length: SUPPORT_PHOTO_MAX }, () => jpeg))).toBeNull();
    expect(validatePhotoFiles(Array.from({ length: SUPPORT_PHOTO_MAX + 1 }, () => jpeg))).toMatch(/up to 4/);
    expect(validatePhotoFiles([{ type: "image/gif", size: 10 }])).toMatch(/JPEG, PNG or WebP/);
    expect(validatePhotoFiles([{ type: "application/pdf", size: 10 }])).toMatch(/JPEG, PNG or WebP/);
    expect(validatePhotoFiles([{ type: "image/png", size: 0 }])).toMatch(/empty/);
    expect(validatePhotoFiles([{ type: "image/webp", size: SUPPORT_PHOTO_MAX_BYTES + 1 }])).toMatch(/up to 8 MB/);
    expect(validatePhotoFiles([{ type: "image/webp", size: SUPPORT_PHOTO_MAX_BYTES }])).toBeNull();
  });

  it("validates the report text and type", () => {
    expect(supportCaseSchema.safeParse({ type: "damaged", description: "short" }).success).toBe(false);
    expect(supportCaseSchema.safeParse({ type: "lost", description: "A long enough text" }).success).toBe(false);
    const ok = supportCaseSchema.parse({ type: "wrong", description: "  Got a blue one, ordered red.  " });
    expect(ok).toEqual({ type: "wrong", description: "Got a blue one, ordered red.", photoPaths: [] });
  });

  it("offers goods problems only once the parcel moves", () => {
    expect(reportableTypes({ status: "confirmed", fulfillmentStatus: "packed" })).toEqual(["other"]);
    expect(reportableTypes({ status: "completed", fulfillmentStatus: "delivered" })).toEqual([
      "damaged",
      "defective",
      "wrong",
      "missing",
      "other",
    ]);
    expect(reportableTypes({ status: "expired", fulfillmentStatus: "unfulfilled" })).toEqual([]);
  });
});

describe("order page copy", () => {
  const base = { paymentMethod: "razorpay" as const, paymentStatus: "paid", status: "confirmed", totalPaise: 40800, email: "a@b.in" };

  it("explains each status plainly", () => {
    expect(headline({ statusLabel: "Confirmed" })).toBe("Thank you, your order is confirmed");
    expect(headline({ statusLabel: "Out for delivery" })).toBe("Your order is out for delivery");
    expect(nextSteps({ ...base, statusLabel: "Confirmed" })).toContain("received your payment");
    expect(nextSteps({ ...base, paymentMethod: "cod", statusLabel: "Confirmed" })).toContain("₹408");
  });

  it("says what happens to money on a cancelled order", () => {
    expect(nextSteps({ ...base, statusLabel: "Cancelled" })).toContain("original payment method");
    expect(nextSteps({ ...base, paymentMethod: "cod", statusLabel: "Cancelled" })).toContain("nothing to refund");
  });

  it("describes the payment line for online and cash orders", () => {
    expect(paymentLine(base)).toBe("Paid online");
    expect(paymentLine({ ...base, paymentStatus: "refunded" })).toBe("Paid online (refunded)");
    expect(paymentLine({ ...base, paymentMethod: "cod", paymentStatus: "cod_pending" })).toContain("pay ₹408 when it arrives");
    expect(paymentLine({ ...base, paymentMethod: "cod", paymentStatus: "cod_collected" })).toBe("Cash on delivery: paid");
  });
});
