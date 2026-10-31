import { describe, expect, it } from "vitest";

import {
  DELETE_CONFIRMATION,
  MAX_ADDRESSES,
  accountAddressSchema,
  deleteAccountSchema,
  loginEmailSchema,
  otpCodeSchema,
  parsePageParam,
  profileSchema,
  safeNextPath,
  verifyCodeSchema,
} from "@/features/account/schema";

describe("safeNextPath", () => {
  it("keeps same-origin relative paths, with their query and hash", () => {
    expect(safeNextPath("/account/orders/IFO-1")).toBe("/account/orders/IFO-1");
    expect(safeNextPath("/checkout?step=2#pay")).toBe("/checkout?step=2#pay");
    expect(safeNextPath("/wishlist")).toBe("/wishlist");
  });

  it("falls back to /account for anything missing or odd", () => {
    expect(safeNextPath(undefined)).toBe("/account");
    expect(safeNextPath(null)).toBe("/account");
    expect(safeNextPath(42)).toBe("/account");
    expect(safeNextPath("")).toBe("/account");
    expect(safeNextPath("   ")).toBe("/account");
    expect(safeNextPath("account/orders")).toBe("/account");
  });

  it("refuses open-redirect shapes", () => {
    for (const bad of [
      "https://evil.example/phish",
      "http://evil.example",
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/\t/evil.example",
      "/foo\nbar",
      "javascript:alert(1)",
      "data:text/html,hi",
      `/${"a".repeat(600)}`,
    ]) {
      expect(safeNextPath(bad), bad).toBe("/account");
    }
  });

  it("does not loop back into the login page", () => {
    expect(safeNextPath("/account/login")).toBe("/account");
    expect(safeNextPath("/account/login?next=/x")).toBe("/account");
  });

  it("uses the caller's fallback", () => {
    expect(safeNextPath("https://evil.example", "/")).toBe("/");
  });
});

describe("login schemas", () => {
  it("normalises the email", () => {
    expect(loginEmailSchema.parse({ email: "  Asha@Example.COM " }).email).toBe("asha@example.com");
    expect(loginEmailSchema.safeParse({ email: "nope" }).success).toBe(false);
  });

  it("accepts a six-digit code, ignoring spaces and dashes", () => {
    expect(otpCodeSchema.parse("123456")).toBe("123456");
    expect(otpCodeSchema.parse(" 123 456 ")).toBe("123456");
    expect(otpCodeSchema.parse("123-456")).toBe("123456");
  });

  it("rejects codes that are not six digits", () => {
    for (const bad of ["12345", "1234567", "abcdef", "12 34 5a", ""]) {
      expect(otpCodeSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(verifyCodeSchema.safeParse({ email: "a@b.co", code: "12" }).success).toBe(false);
  });
});

describe("profileSchema", () => {
  it("normalises the phone and treats a blank phone as none", () => {
    expect(
      profileSchema.parse({ name: " Asha Rao ", phone: "98765 43210", marketingOptIn: false }),
    ).toEqual({
      name: "Asha Rao",
      phone: "+919876543210",
      marketingOptIn: false,
    });
    expect(
      profileSchema.parse({ name: "Asha", phone: "  ", marketingOptIn: true }).phone,
    ).toBeNull();
  });

  it("rejects a non-Indian-mobile phone and a missing name", () => {
    const phone = profileSchema.safeParse({ name: "Asha", phone: "12345", marketingOptIn: false });
    expect(phone.success).toBe(false);
    expect(phone.error?.issues[0]?.message).toMatch(/10-digit Indian mobile number/);
    expect(profileSchema.safeParse({ name: "", phone: "", marketingOptIn: false }).success).toBe(
      false,
    );
    expect(profileSchema.safeParse({ name: "A", phone: "", marketingOptIn: false }).success).toBe(
      false,
    );
  });

  it("requires the marketing choice to be explicit (no silent default)", () => {
    expect(profileSchema.safeParse({ name: "Asha", phone: "" }).success).toBe(false);
  });
});

describe("accountAddressSchema", () => {
  const valid = {
    name: "Asha Rao",
    phone: "9876543210",
    line1: "12 Marine Drive",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400001",
  };

  it("uses the checkout's address rules and normalises the phone", () => {
    const out = accountAddressSchema.parse({
      ...valid,
      line2: "",
      landmark: " Near the sea ",
      isDefault: true,
    });
    expect(out.phone).toBe("+919876543210");
    expect(out.line2).toBeUndefined();
    expect(out.landmark).toBe("Near the sea");
    expect(out.isDefault).toBe(true);
  });

  it("rejects bad pincodes and phones", () => {
    for (const pincode of ["012345", "12345", "1234567", "abcdef"]) {
      expect(accountAddressSchema.safeParse({ ...valid, pincode }).success, pincode).toBe(false);
    }
    expect(accountAddressSchema.safeParse({ ...valid, phone: "5876543210" }).success).toBe(false);
  });

  it("requires the core fields", () => {
    for (const key of ["name", "phone", "line1", "city", "state", "pincode"] as const) {
      expect(accountAddressSchema.safeParse({ ...valid, [key]: "" }).success, key).toBe(false);
    }
  });

  it("caps the address book at ten", () => {
    expect(MAX_ADDRESSES).toBe(10);
  });
});

describe("deleteAccountSchema", () => {
  it("needs the word typed out (any case, trimmed)", () => {
    expect(deleteAccountSchema.safeParse({ confirmation: DELETE_CONFIRMATION }).success).toBe(true);
    expect(deleteAccountSchema.safeParse({ confirmation: " delete " }).success).toBe(true);
    expect(deleteAccountSchema.safeParse({ confirmation: "delet" }).success).toBe(false);
    expect(deleteAccountSchema.safeParse({ confirmation: "" }).success).toBe(false);
  });
});

describe("parsePageParam", () => {
  it("returns a positive integer, 1 for anything unusable", () => {
    expect(parsePageParam("3")).toBe(3);
    expect(parsePageParam(["2", "9"])).toBe(2);
    for (const bad of [undefined, "", "0", "-1", "abc", "1.5x", "99999999"]) {
      expect(parsePageParam(bad), String(bad)).toBe(1);
    }
  });
});
