"use client";

import { useId, useState, useTransition } from "react";

import { Button, Icon, Input } from "@/components/ui";
import { formatINR } from "@/lib/money";

import { checkDelivery, type DeliveryCheck } from "./delivery-action";
import { formatDeliveryWindow } from "./product-model";

type Outcome = { kind: "result"; data: DeliveryCheck } | { kind: "error"; message: string } | null;

/** "Deliver to" pincode check: serviceability, COD availability and the estimated delivery window. */
export function DeliveryEstimate() {
  const inputId = useId();
  const [pincode, setPincode] = useState("");
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const value = pincode.trim();
    if (!/^[1-9][0-9]{5}$/.test(value)) {
      setOutcome({ kind: "error", message: "Enter a valid 6-digit pincode." });
      return;
    }
    startTransition(async () => {
      try {
        const result = await checkDelivery({ pincode: value });
        setOutcome(
          result.ok ? { kind: "result", data: result.data } : { kind: "error", message: result.error.message },
        );
      } catch {
        setOutcome({ kind: "error", message: "We couldn't check that pincode. Please try again." });
      }
    });
  };

  return (
    <section aria-labelledby={`${inputId}-title`} className="flex flex-col gap-2" data-testid="delivery-estimate">
      <h2 id={`${inputId}-title`} className="flex items-center gap-2 text-base font-bold">
        <Icon name="truck" className="size-5" />
        Delivery estimate
      </h2>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex gap-2"
      >
        <label htmlFor={inputId} className="sr-only">
          Delivery pincode
        </label>
        <Input
          id={inputId}
          name="pincode"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          placeholder="Enter pincode"
          value={pincode}
          onChange={(event) => setPincode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          aria-describedby={`${inputId}-result`}
          className="max-w-48"
        />
        <Button type="submit" variant="secondary" loading={pending}>
          Check
        </Button>
      </form>
      <div id={`${inputId}-result`} role="status" aria-live="polite" className="text-sm empty:hidden" data-testid="delivery-result">
        {outcome?.kind === "error" ? (
          <p className="flex items-start gap-2 font-semibold text-danger">
            <Icon name="alert-circle" className="mt-0.5 size-4 flex-none" />
            {outcome.message}
          </p>
        ) : null}
        {outcome?.kind === "result" ? <Result data={outcome.data} /> : null}
      </div>
    </section>
  );
}

function Result({ data }: { data: DeliveryCheck }) {
  if (!data.serviceable) {
    return (
      <p className="flex items-start gap-2 font-semibold text-danger">
        <Icon name="alert-circle" className="mt-0.5 size-4 flex-none" />
        {data.message ?? "We can't deliver to this pincode yet."}
      </p>
    );
  }
  const place = [data.city, data.state].filter(Boolean).join(", ");
  return (
    <ul className="flex flex-col gap-1 text-ink">
      <li className="flex items-start gap-2">
        <Icon name="check" className="mt-0.5 size-4 flex-none text-success" />
        <span>
          We deliver to {data.pincode}
          {place ? ` (${place})` : ""}.
        </span>
      </li>
      {data.delivery ? (
        <li className="flex items-start gap-2">
          <Icon name="package" className="mt-0.5 size-4 flex-none" />
          <span>
            Estimated delivery: <strong>{formatDeliveryWindow(data.delivery.fromDate, data.delivery.toDate)}</strong>
          </span>
        </li>
      ) : null}
      <li className="flex items-start gap-2">
        <Icon name={data.codAllowed ? "check" : "info"} className="mt-0.5 size-4 flex-none" />
        <span>
          {data.codAllowed
            ? `Cash on delivery is available${data.codMaxOrderPaise > 0 ? ` for orders up to ${formatINR(data.codMaxOrderPaise)}` : ""}.`
            : "Cash on delivery is not available here. Pay online at checkout."}
        </span>
      </li>
    </ul>
  );
}
