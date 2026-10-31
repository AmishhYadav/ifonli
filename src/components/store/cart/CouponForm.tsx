"use client";

import { useId, useState, useTransition } from "react";

import { Button, Field, Input } from "@/components/ui";
import type { CartViewCoupon } from "@/features/cart/types";

import { applyCouponCode, removeCouponCode } from "./cart-store";

/**
 * Coupon code field. Errors are the service's own messages ("Add ₹150 more to use SAVE10", "That code
 * has expired", ...), shown under the field. An applied code shows as a line with a Remove button; a
 * code kept on the cart but not applicable yet shows the service's explanation.
 */
export function CouponForm({ coupon }: { coupon: CartViewCoupon | null }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const statusId = useId();

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await applyCouponCode(code);
      if (result.ok) setCode("");
      else setError(result.error.message);
    });

  if (coupon) {
    return (
      <div className="flex flex-col gap-2" data-testid="coupon-applied">
        <div className="flex items-center justify-between gap-3 rounded-input border-token bg-surface-2 px-3 py-2">
          <p className="text-base font-semibold">
            <span className="sr-only">Coupon </span>
            {coupon.code}
            <span className="font-normal text-ink-muted">{coupon.applied ? " applied" : " saved"}</span>
          </p>
          <Button
            variant="link"
            size="sm"
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await removeCouponCode();
                if (!result.ok) setError(result.error.message);
              })
            }
          >
            Remove<span className="sr-only"> coupon {coupon.code}</span>
          </Button>
        </div>
        {!coupon.applied && coupon.message ? (
          <p id={statusId} role="status" className="text-sm text-ink-muted">
            {coupon.message}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!code.trim()) {
          setError("Enter a coupon code.");
          return;
        }
        submit();
      }}
      className="flex flex-col gap-2"
      data-testid="coupon-form"
    >
      <Field label="Coupon code" error={error}>
        <div className="flex gap-2">
          <Input
            name="coupon"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={64}
            className="uppercase placeholder:normal-case"
            placeholder="Enter code"
          />
          <Button type="submit" variant="secondary" loading={pending} className="flex-none">
            Apply
          </Button>
        </div>
      </Field>
    </form>
  );
}
