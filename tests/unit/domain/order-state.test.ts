import { describe, expect, it } from "vitest";

import {
  allowedTransitions,
  assertTransition,
  canTransition,
  customerStatusLabel,
  FULFILLMENT_STATUSES,
  FULFILLMENT_TRANSITIONS,
  isCustomerCancellable,
  isTerminal,
  ORDER_STATUSES,
  OrderTransitionError,
  PAYMENT_STATUSES,
  PAYMENT_TRANSITIONS,
  refundableAmount,
  STATUS_TRANSITIONS,
  type FulfillmentStatus,
  type OrderStateSnapshot,
} from "@/server/domain";

describe("transition tables", () => {
  it("cover every state on every axis, with only known targets", () => {
    for (const [table, states] of [
      [STATUS_TRANSITIONS, ORDER_STATUSES],
      [PAYMENT_TRANSITIONS, PAYMENT_STATUSES],
      [FULFILLMENT_TRANSITIONS, FULFILLMENT_STATUSES],
    ] as const) {
      expect(Object.keys(table).sort()).toEqual([...states].sort());
      for (const from of states) {
        for (const to of table[from as keyof typeof table] as readonly string[]) {
          expect(states as readonly string[]).toContain(to);
          expect(to).not.toBe(from);
        }
      }
    }
  });
});

describe("every allowed transition passes", () => {
  const status = Object.entries(STATUS_TRANSITIONS).flatMap(([f, ts]) =>
    ts.map((t) => [f, t] as const),
  );
  const payment = Object.entries(PAYMENT_TRANSITIONS).flatMap(([f, ts]) =>
    ts.map((t) => [f, t] as const),
  );
  const fulfillment = Object.entries(FULFILLMENT_TRANSITIONS).flatMap(([f, ts]) =>
    ts.map((t) => [f, t] as const),
  );

  it.each(status)("status %s -> %s", (from, to) => {
    const f = from as (typeof ORDER_STATUSES)[number];
    const t = to as (typeof ORDER_STATUSES)[number];
    expect(canTransition("status", f, t)).toBe(true);
    expect(() => assertTransition("status", f, t)).not.toThrow();
  });
  it.each(payment)("payment %s -> %s", (from, to) => {
    const f = from as (typeof PAYMENT_STATUSES)[number];
    const t = to as (typeof PAYMENT_STATUSES)[number];
    expect(canTransition("payment", f, t)).toBe(true);
    expect(() => assertTransition("payment", f, t)).not.toThrow();
  });
  it.each(fulfillment)("fulfillment %s -> %s", (from, to) => {
    const f = from as FulfillmentStatus;
    const t = to as FulfillmentStatus;
    expect(canTransition("fulfillment", f, t)).toBe(true);
    expect(() => assertTransition("fulfillment", f, t)).not.toThrow();
  });
});

describe("illegal transitions throw", () => {
  it("rejects a sample on each axis", () => {
    const cases: [() => void, string][] = [
      [() => assertTransition("status", "pending_payment", "completed"), "status"],
      [() => assertTransition("status", "confirmed", "pending_payment"), "status"],
      [() => assertTransition("status", "cancelled", "confirmed"), "status"],
      [() => assertTransition("status", "completed", "cancelled"), "status"],
      [() => assertTransition("status", "expired", "cancelled"), "status"],
      [() => assertTransition("payment", "unpaid", "refunded"), "payment"],
      [() => assertTransition("payment", "refunded", "paid"), "payment"],
      [() => assertTransition("payment", "paid", "unpaid"), "payment"],
      [() => assertTransition("payment", "cod_pending", "paid"), "payment"],
      [() => assertTransition("fulfillment", "unfulfilled", "shipped"), "fulfillment"],
      [() => assertTransition("fulfillment", "delivered", "shipped"), "fulfillment"],
      [() => assertTransition("fulfillment", "returned", "delivered"), "fulfillment"],
      [() => assertTransition("fulfillment", "unfulfilled", "rto"), "fulfillment"],
    ];
    for (const [fn, axis] of cases) {
      expect(fn).toThrow(OrderTransitionError);
      try {
        fn();
      } catch (e) {
        expect((e as OrderTransitionError).axis).toBe(axis);
        expect((e as OrderTransitionError).message).toMatch(/Illegal .* transition: \w+ -> \w+/);
      }
    }
  });

  it("treats same-state as not a transition", () => {
    expect(canTransition("status", "confirmed", "confirmed")).toBe(false);
    expect(canTransition("payment", "partially_refunded", "partially_refunded")).toBe(false);
    expect(canTransition("fulfillment", "packed", "packed")).toBe(false);
  });

  it("matches the exhaustive allow-list (everything else is illegal)", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        expect(canTransition("status", from, to)).toBe(STATUS_TRANSITIONS[from].includes(to));
      }
    }
    for (const from of PAYMENT_STATUSES) {
      for (const to of PAYMENT_STATUSES) {
        expect(canTransition("payment", from, to)).toBe(PAYMENT_TRANSITIONS[from].includes(to));
      }
    }
    for (const from of FULFILLMENT_STATUSES) {
      for (const to of FULFILLMENT_STATUSES) {
        expect(canTransition("fulfillment", from, to)).toBe(
          FULFILLMENT_TRANSITIONS[from].includes(to),
        );
      }
    }
  });
});

describe("terminal states", () => {
  it("completed, cancelled, refunded, returned have no exits", () => {
    expect(isTerminal("status", "completed")).toBe(true);
    expect(isTerminal("status", "cancelled")).toBe(true);
    expect(isTerminal("payment", "refunded")).toBe(true);
    expect(isTerminal("fulfillment", "returned")).toBe(true);
    expect(allowedTransitions("status", "cancelled")).toEqual([]);
  });

  it("expired -> confirmed is the documented late-capture exception", () => {
    expect(isTerminal("status", "expired")).toBe(false);
    expect(allowedTransitions("status", "expired")).toEqual(["confirmed"]);
  });

  it("non-terminal states have exits", () => {
    expect(isTerminal("status", "pending_payment")).toBe(false);
    expect(isTerminal("payment", "paid")).toBe(false);
    expect(isTerminal("fulfillment", "shipped")).toBe(false);
  });
});

describe("customerStatusLabel", () => {
  const o = (over: Partial<OrderStateSnapshot>): OrderStateSnapshot => ({
    status: "confirmed",
    paymentStatus: "paid",
    fulfillmentStatus: "unfulfilled",
    ...over,
  });

  it.each([
    [o({ status: "pending_payment", paymentStatus: "unpaid" }), "Payment pending"],
    [o({}), "Confirmed"],
    [o({ status: "processing" }), "Confirmed"],
    [o({ paymentStatus: "cod_pending" }), "Confirmed"],
    [o({ status: "processing", fulfillmentStatus: "packed" }), "Packed"],
    [o({ status: "processing", fulfillmentStatus: "shipped" }), "Shipped"],
    [o({ status: "processing", fulfillmentStatus: "out_for_delivery" }), "Out for delivery"],
    [o({ status: "completed", fulfillmentStatus: "delivered" }), "Delivered"],
    [o({ status: "completed" }), "Delivered"],
    [o({ status: "cancelled", paymentStatus: "unpaid" }), "Cancelled"],
    [o({ status: "expired", paymentStatus: "unpaid" }), "Cancelled"],
    [o({ status: "cancelled", paymentStatus: "refunded" }), "Refunded"],
    [
      o({ paymentStatus: "refunded", fulfillmentStatus: "delivered", status: "completed" }),
      "Refunded",
    ],
    [o({ status: "cancelled", paymentStatus: "partially_refunded" }), "Cancelled"],
    [
      o({
        paymentStatus: "partially_refunded",
        fulfillmentStatus: "delivered",
        status: "completed",
      }),
      "Delivered",
    ],
    [o({ fulfillmentStatus: "rto", status: "processing" }), "Shipped"],
    [o({ fulfillmentStatus: "returned", status: "processing" }), "Cancelled"],
  ] as const)("%j -> %s", (order, label) => {
    expect(customerStatusLabel(order)).toBe(label);
  });

  it("only ever returns one of the eight documented labels", () => {
    const allowed = new Set([
      "Payment pending",
      "Confirmed",
      "Packed",
      "Shipped",
      "Out for delivery",
      "Delivered",
      "Cancelled",
      "Refunded",
    ]);
    for (const status of ORDER_STATUSES)
      for (const paymentStatus of PAYMENT_STATUSES)
        for (const fulfillmentStatus of FULFILLMENT_STATUSES)
          expect(
            allowed.has(customerStatusLabel({ status, paymentStatus, fulfillmentStatus })),
          ).toBe(true);
  });
});

describe("isCustomerCancellable", () => {
  const cancellable: FulfillmentStatus[] = ["unfulfilled"];
  const o = (over: Partial<OrderStateSnapshot>): OrderStateSnapshot => ({
    status: "confirmed",
    paymentStatus: "paid",
    fulfillmentStatus: "unfulfilled",
    ...over,
  });

  it("allows while unfulfilled and not finished", () => {
    expect(isCustomerCancellable(o({}), cancellable)).toBe(true);
    expect(
      isCustomerCancellable(o({ status: "pending_payment", paymentStatus: "unpaid" }), cancellable),
    ).toBe(true);
    expect(isCustomerCancellable(o({ status: "processing" }), cancellable)).toBe(true);
    expect(isCustomerCancellable(o({ paymentStatus: "cod_pending" }), cancellable)).toBe(true);
  });

  it("blocks once packed/shipped (default config)", () => {
    expect(isCustomerCancellable(o({ fulfillmentStatus: "packed" }), cancellable)).toBe(false);
    expect(isCustomerCancellable(o({ fulfillmentStatus: "shipped" }), cancellable)).toBe(false);
  });

  it("follows the configured list", () => {
    expect(
      isCustomerCancellable(o({ fulfillmentStatus: "packed" }), ["unfulfilled", "packed"]),
    ).toBe(true);
    expect(isCustomerCancellable(o({}), [])).toBe(false);
  });

  it("blocks finished orders", () => {
    for (const status of ["completed", "cancelled", "expired"] as const) {
      expect(isCustomerCancellable(o({ status }), cancellable)).toBe(false);
    }
    expect(isCustomerCancellable(o({ paymentStatus: "refunded" }), cancellable)).toBe(false);
  });
});

describe("refundableAmount", () => {
  it("is captured - refunded", () => {
    expect(refundableAmount(10_000, 0)).toBe(10_000);
    expect(refundableAmount(10_000, 2_500)).toBe(7_500);
    expect(refundableAmount(10_000, 10_000)).toBe(0);
  });

  it("never goes negative", () => {
    expect(refundableAmount(10_000, 12_000)).toBe(0);
  });

  it("rejects bad input", () => {
    expect(() => refundableAmount(-1, 0)).toThrow(RangeError);
    expect(() => refundableAmount(100, -1)).toThrow(RangeError);
    expect(() => refundableAmount(1.5, 0)).toThrow(RangeError);
    expect(() => refundableAmount(100, Number.NaN)).toThrow(RangeError);
  });
});
