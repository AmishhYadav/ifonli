"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { formatDateRange, formatDateTime } from "@/components/orders/format";
import { OrderTimeline } from "@/components/orders/OrderTimeline";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Field,
  Icon,
  Input,
  type BadgeTone,
} from "@/components/ui";
import { formatINR } from "@/lib/money";

import { trackOrder } from "./actions";
import { INITIAL_TRACK_STATE, type TrackedOrder } from "./types";

const TERMINAL = new Set(["Cancelled", "Refunded", "Delivered"]);

function statusTone(label: string): BadgeTone {
  if (label === "Cancelled") return "danger";
  if (label === "Refunded") return "neutral";
  return label === "Payment pending" ? "warning" : "success";
}

function ShipmentCard({ order }: { order: TrackedOrder }) {
  const { shipment } = order;
  if (shipment) {
    return (
      <Card as="section" aria-labelledby="track-shipment" data-testid="shipment">
        <CardTitle id="track-shipment" as="h2" className="mb-3">
          Shipment
        </CardTitle>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-base">
          <dt className="text-ink-muted">Courier</dt>
          <dd data-testid="shipment-courier">{shipment.courier}</dd>
          {shipment.awb ? (
            <>
              <dt className="text-ink-muted">Tracking number</dt>
              <dd className="break-all" data-testid="shipment-awb">
                {shipment.awb}
              </dd>
            </>
          ) : null}
          {shipment.shippedAt ? (
            <>
              <dt className="text-ink-muted">Shipped</dt>
              <dd>{formatDateTime(shipment.shippedAt)}</dd>
            </>
          ) : null}
          {shipment.deliveredAt ? (
            <>
              <dt className="text-ink-muted">Delivered</dt>
              <dd>{formatDateTime(shipment.deliveredAt)}</dd>
            </>
          ) : null}
        </dl>
        {shipment.trackingUrl ? (
          <p className="mt-3">
            <a
              href={shipment.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-link underline underline-offset-4 hover:no-underline"
            >
              Track on {shipment.courier}&apos;s website
              <Icon name="external-link" className="size-4" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </p>
        ) : null}
      </Card>
    );
  }
  if (TERMINAL.has(order.statusLabel)) return null;
  return (
    <Card as="section" aria-labelledby="track-shipment" data-testid="no-shipment">
      <CardTitle id="track-shipment" as="h2" className="mb-2">
        Shipment
      </CardTitle>
      {order.statusLabel === "Payment pending" ? (
        <p className="text-base">
          We&apos;re waiting for your payment. Your order ships after it is confirmed.
        </p>
      ) : (
        <p className="text-base">
          Your order hasn&apos;t shipped yet. We&apos;ll email you the courier and tracking number
          as soon as it does.
          {order.expectedDelivery
            ? ` Estimated delivery ${formatDateRange(order.expectedDelivery.fromDate, order.expectedDelivery.toDate)}.`
            : ""}
        </p>
      )}
    </Card>
  );
}

/** Order lookup form and, on a match, the order's status, shipment and history. */
export function TrackForm() {
  const [state, action, pending] = useActionState(trackOrder, INITIAL_TRACK_STATE);
  const [ref, setRef] = useState(state.values.ref);
  const [contact, setContact] = useState(state.values.contact);
  const resultRef = useRef<HTMLDivElement>(null);
  const refInput = useRef<HTMLInputElement>(null);
  const contactInput = useRef<HTMLInputElement>(null);

  // After each answer, move focus to it (or to the first invalid field) so it is announced and in view.
  useEffect(() => {
    if (state.status === "idle") return;
    if (state.status === "invalid")
      (state.fieldErrors?.ref ? refInput : contactInput).current?.focus();
    else resultRef.current?.focus();
  }, [state]);

  const { order } = state;
  return (
    <>
      <form
        action={action}
        noValidate
        className="flex flex-col gap-4 rounded-card border-token bg-surface p-4 shadow-card sm:p-5"
      >
        <Field label="Order reference" required error={state.fieldErrors?.ref}>
          <Input
            ref={refInput}
            name="ref"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="IFO-2611-7K3Q"
            maxLength={64}
          />
        </Field>
        <Field
          label="Email or mobile number"
          required
          hint="The one you used when you placed the order."
          error={state.fieldErrors?.contact}
        >
          <Input
            ref={contactInput}
            name="contact"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
          />
        </Field>
        <div>
          <Button type="submit" loading={pending} iconStart="search">
            Track order
          </Button>
        </div>
      </form>

      <div
        ref={resultRef}
        tabIndex={-1}
        aria-live="polite"
        className="outline-none"
        data-testid="track-result"
      >
        {state.status === "not_found" ||
        state.status === "rate_limited" ||
        state.status === "error" ? (
          <p className="flex items-start gap-2 rounded-card border-token border-danger bg-surface p-4 text-base font-semibold text-danger">
            <Icon name="alert-circle" className="mt-0.5 size-5 flex-none" />
            {state.message}
          </p>
        ) : null}

        {state.status === "found" && order ? (
          <div className="flex flex-col gap-5">
            <header className="flex flex-col gap-2">
              <h2 className="font-display text-2xl leading-tight">
                Order <span data-testid="track-ref">{order.ref}</span>
              </h2>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Badge tone={statusTone(order.statusLabel)} data-testid="track-status">
                  {order.statusLabel}
                </Badge>
                <span className="text-sm text-ink-muted">
                  Placed {formatDateTime(order.placedAt)} · {formatINR(order.totalPaise)}
                  {order.paymentMethod === "cod" ? " · Cash on delivery" : ""}
                </span>
              </p>
            </header>
            <ShipmentCard order={order} />
            <Card as="section" aria-labelledby="track-history">
              <CardTitle id="track-history" as="h2" className="mb-4">
                Order history
              </CardTitle>
              <OrderTimeline events={order.events} />
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
