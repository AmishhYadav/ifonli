"use client";

import { useState, useTransition } from "react";

import { lookupPincode } from "@/features/checkout/actions";
import type { PincodeLookup } from "@/server/services/checkout";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

/** The T. A. Pai Management Institute (MAHE) campus in Govindapura, Yelahanka, Bengaluru. */
const CAMPUS_PINCODE = "560064";

const ZONE_LABELS: Record<string, string> = {
  metro_region: "Metro region",
  rest_of_india: "Rest of India",
  north_east: "North East",
  jk_ladakh: "Jammu & Kashmir and Ladakh",
  islands: "Islands",
};

export interface PincodeCheckProps {
  /** Transit range in working days per zone (the delivery-estimate settings). */
  estimates: Record<string, { minDays: number; maxDays: number } | undefined>;
  processingDays: number;
}

type Answer = { kind: "ok"; lookup: PincodeLookup } | { kind: "no"; message: string };

/** "Enter your pincode": says whether India Post delivers there (the pincode directory) and the estimate. */
export function PincodeCheck({ estimates, processingDays }: PincodeCheckProps) {
  const [pincode, setPincode] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [pending, startTransition] = useTransition();

  function check() {
    const value = pincode.trim();
    if (!/^[1-9][0-9]{5}$/.test(value)) {
      setAnswer({ kind: "no", message: "Enter a valid 6-digit pincode." });
      return;
    }
    startTransition(async () => {
      const res = await lookupPincode({ pincode: value });
      if (!res.ok) {
        setAnswer({ kind: "no", message: res.error.message });
        return;
      }
      const d = res.data;
      if (d.status === "ok") setAnswer({ kind: "ok", lookup: d });
      else if (d.status === "unserviceable")
        setAnswer({
          kind: "no",
          message: `Sorry, India Post has no delivery post office for ${d.pincode}, so we can't deliver there yet.`,
        });
      else if (d.status === "unknown")
        setAnswer({
          kind: "no",
          message:
            "We couldn't find that pincode in India Post's list. Please check it and try again.",
        });
      else setAnswer({ kind: "no", message: d.message ?? "Enter a valid 6-digit pincode." });
    });
  }

  const range =
    answer?.kind === "ok" && answer.lookup.zone ? estimates[answer.lookup.zone] : undefined;

  return (
    <section
      aria-labelledby="pincode-heading"
      className="mt-10 rounded-card bg-surface p-5 shadow-card"
    >
      <h2 id="pincode-heading" className="font-display text-2xl leading-tight">
        Check delivery to your pincode
      </h2>
      <p className="mt-1 text-base text-ink-muted">
        We deliver to every pincode that has an India Post delivery post office.
      </p>
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          check();
        }}
        noValidate
      >
        <Field label="Enter your pincode" className="w-full max-w-60">
          <Input
            name="pincode"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            placeholder="e.g. 560064"
            value={pincode}
            onChange={(e) => setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </Field>
        <Button type="submit" loading={pending}>
          Check
        </Button>
      </form>
      <div aria-live="polite" className="mt-4 text-base">
        {answer?.kind === "no" ? (
          <p className="flex items-start gap-2 text-ink">
            <Icon name="close" className="mt-1 size-4 flex-none" />
            {answer.message}
          </p>
        ) : null}
        {answer?.kind === "ok" ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-start gap-2 font-semibold">
              <Icon name="check" className="mt-1 size-4 flex-none" />
              Yes, we deliver to {answer.lookup.pincode}
              {answer.lookup.city ? ` (${answer.lookup.city}, ${answer.lookup.state})` : ""}.
            </p>
            {range ? (
              <p className="text-ink-muted">
                Estimated delivery: {range.minDays} to {range.maxDays} days after dispatch
                {answer.lookup.zone
                  ? ` (${ZONE_LABELS[answer.lookup.zone] ?? answer.lookup.zone})`
                  : ""}
                . Orders are usually processed within {processingDays} working{" "}
                {processingDays === 1 ? "day" : "days"}.
              </p>
            ) : null}
            {answer.lookup.pincode === CAMPUS_PINCODE ? (
              <p className="rounded-input bg-bg p-3 font-semibold">
                Inside the MAHE Bengaluru campus, your order is delivered within 24 hours, with free
                delivery.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
