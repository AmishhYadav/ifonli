import { describe, expect, it } from "vitest";

import {
  addressSchema,
  checkoutFormSchema,
  checkoutQuoteSchema,
  emailSchema,
  normalizeIndianPhone,
  phoneSchema,
  pincodeSchema,
  placeOrderSchema,
} from "@/features/checkout/schema";

const address = {
  name: "Asha Rao",
  line1: "12 Marine Drive",
  city: "Mumbai",
  state: "Maharashtra",
  pincode: "400001",
};
const form = {
  email: "asha@example.com",
  phone: "9876543210",
  shippingAddress: address,
  paymentMethod: "razorpay" as const,
  policyAck: true as const,
};

const messages = (r: { success: false; error: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));

describe("normalizeIndianPhone", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["98765-43210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["+91-(98765) 43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["6000000000", "+916000000000"],
  ])("accepts %s", (input, out) => {
    expect(normalizeIndianPhone(input)).toBe(out);
  });

  it.each([
    "",
    "12345",
    "5876543210", // must start 6-9
    "98765432101",
    "+1 9876543210",
    "+44 7911 123456",
    "abcdefghij",
    "98765 4321x",
    "0919876543210",
    "+91 98765 4321",
  ])("rejects %j", (input) => {
    expect(normalizeIndianPhone(input)).toBeNull();
  });
});

describe("phoneSchema / emailSchema / pincodeSchema", () => {
  it("normalises the phone and gives a human error", () => {
    expect(phoneSchema.parse(" 98765 43210 ")).toBe("+919876543210");
    const r = phoneSchema.safeParse("1234");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toBe("Enter a 10-digit Indian mobile number, like 98765 43210");
    const empty = phoneSchema.safeParse("");
    if (!empty.success) expect(empty.error.issues[0]!.message).toBe("Enter your mobile number");
  });

  it("trims and lower-cases the email", () => {
    expect(emailSchema.parse("  Asha@Example.COM ")).toBe("asha@example.com");
    for (const bad of ["", "asha", "asha@", "@example.com", "a b@example.com"]) {
      expect(emailSchema.safeParse(bad).success).toBe(false);
    }
    const r = emailSchema.safeParse("");
    if (!r.success) expect(r.error.issues[0]!.message).toBe("Enter your email address");
  });

  it("accepts 6-digit pincodes that do not start with 0", () => {
    expect(pincodeSchema.parse(" 400001 ")).toBe("400001");
    for (const bad of ["", "40001", "4000011", "040001", "40000a", "400 001"]) {
      expect(pincodeSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("addressSchema", () => {
  it("accepts a full address, trims text and drops empty optional lines", () => {
    const out = addressSchema.parse({ ...address, name: "  Asha Rao ", line2: "  ", landmark: "Near park " });
    expect(out.name).toBe("Asha Rao");
    expect(out.line2).toBeUndefined();
    expect(out.landmark).toBe("Near park");
  });

  it("reports each missing field with a specific message", () => {
    const r = addressSchema.safeParse({ name: "A", line1: "", city: "", state: "", pincode: "1" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(messages(r)).toEqual({
        name: "Enter the recipient's full name",
        line1: "Enter your house or flat number and street",
        city: "Enter your city or town",
        state: "Choose your state",
        pincode: "Enter a valid 6-digit pincode",
      });
    }
    const missing = addressSchema.safeParse({});
    expect(missing.success).toBe(false);
  });
});

describe("checkoutFormSchema", () => {
  it("accepts a valid form and normalises the values", () => {
    const out = checkoutFormSchema.parse({ ...form, email: "ASHA@Example.com", phone: "+91 98765 43210" });
    expect(out.email).toBe("asha@example.com");
    expect(out.phone).toBe("+919876543210");
    expect(out.policyAck).toBe(true);
  });

  it("requires the policy acknowledgement to be explicitly ticked", () => {
    for (const policyAck of [false, undefined, "true", 1, null]) {
      const r = checkoutFormSchema.safeParse({ ...form, policyAck });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(messages(r).policyAck).toBe(
          "Please tick the box to confirm you've read our returns, terms and privacy policies",
        );
      }
    }
  });

  it("only allows the two payment methods", () => {
    expect(checkoutFormSchema.safeParse({ ...form, paymentMethod: "cod" }).success).toBe(true);
    for (const paymentMethod of ["upi", "", undefined, "COD"]) {
      const r = checkoutFormSchema.safeParse({ ...form, paymentMethod });
      expect(r.success).toBe(false);
      if (!r.success) expect(messages(r).paymentMethod).toBe("Choose how you'd like to pay");
    }
  });

  it("collects every field error at once", () => {
    const r = checkoutFormSchema.safeParse({ email: "x", phone: "1", shippingAddress: {}, policyAck: false });
    expect(r.success).toBe(false);
    if (!r.success) {
      const m = messages(r);
      expect(Object.keys(m)).toEqual(
        expect.arrayContaining(["email", "phone", "shippingAddress.name", "shippingAddress.pincode", "policyAck", "paymentMethod"]),
      );
    }
  });
});

describe("placeOrderSchema", () => {
  const key = "6f1c1d7e-5a52-4d0e-9b63-0a1b2c3d4e5f";

  it("adds the idempotency key and an optional vibe", () => {
    const out = placeOrderSchema.parse({ ...form, idempotencyKey: key, vibe: "gothic" });
    expect(out.idempotencyKey).toBe(key);
    expect(out.vibe).toBe("gothic");
    expect(placeOrderSchema.parse({ ...form, idempotencyKey: key }).vibe).toBeUndefined();
    expect(placeOrderSchema.parse({ ...form, idempotencyKey: key, vibe: null }).vibe).toBeNull();
  });

  it("rejects a missing or malformed key and a junk vibe", () => {
    expect(placeOrderSchema.safeParse({ ...form }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...form, idempotencyKey: "abc" }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...form, idempotencyKey: key, vibe: "Bad Vibe!" }).success).toBe(false);
  });

  it("ignores unknown (client-supplied price) fields", () => {
    const out = placeOrderSchema.parse({ ...form, idempotencyKey: key, totalPaise: 1, items: [] });
    expect(out).not.toHaveProperty("totalPaise");
    expect(out).not.toHaveProperty("items");
  });
});

describe("checkoutQuoteSchema", () => {
  it("treats half-typed values as not entered yet", () => {
    expect(checkoutQuoteSchema.parse({})).toEqual({});
    expect(checkoutQuoteSchema.parse({ pincode: "4000", email: "a@", paymentMethod: "x" })).toEqual({});
    expect(checkoutQuoteSchema.parse({ pincode: "400001", email: "A@B.com", paymentMethod: "cod" })).toEqual({
      pincode: "400001",
      email: "a@b.com",
      paymentMethod: "cod",
    });
  });
});
