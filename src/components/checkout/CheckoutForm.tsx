"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { AmountBreakdown } from "@/components/orders/AmountBreakdown";
import { formatDateRange } from "@/components/orders/format";
import { OrderLines } from "@/components/orders/OrderLines";
import { Button, Checkbox, Field, Icon, Input, Radio, RadioGroup, Spinner } from "@/components/ui";
import { getCheckoutQuote, lookupPincode, placeOrder } from "@/features/checkout/actions";
import {
  PINCODE_PATTERN,
  checkoutFormSchema,
  emailSchema,
  type CheckoutFormInput,
  type CheckoutFormValues,
  type CheckoutPaymentMethod,
} from "@/features/checkout/schema";
import type { CheckoutQuote, PincodeLookup, ShortageItem } from "@/features/checkout/types";
import type { CartView } from "@/features/cart/types";
import { formatINR } from "@/lib/money";

import { EmptyCheckout } from "./EmptyCheckout";
import { PaymentStatusPanel } from "./PaymentStatusPanel";
import { usePayment } from "./usePayment";

export interface CheckoutFormProps {
  /** The cart as rendered on the server (the first paint; the live quote replaces it). */
  initialCart: CartView;
  /** Signed-in customer's email; prefilled. Guests start empty. */
  initialEmail: string | null;
  /** One or two sentences on returns, shown with the acknowledgement. */
  returnSummary: string;
}

/** The schema wants `true`; the box must start unticked, so the default is deliberately not `true`. */
const UNTICKED = false as unknown as true;

const POLICY_LINKS = [
  { href: "/policies/returns-refunds", label: "Returns and refunds policy" },
  { href: "/policies/terms", label: "Terms of use" },
  { href: "/policies/privacy", label: "Privacy policy" },
] as const;

/** Page order: the error summary lists problems in this order. */
const FIELD_LABELS: Record<string, string> = {
  email: "Email",
  phone: "Mobile number",
  "shippingAddress.pincode": "Pincode",
  "shippingAddress.city": "City",
  "shippingAddress.state": "State",
  "shippingAddress.name": "Full name",
  "shippingAddress.line1": "Address",
  "shippingAddress.line2": "Address line 2",
  "shippingAddress.landmark": "Landmark",
  paymentMethod: "Payment method",
  policyAck: "Policy acknowledgement",
};
const FIELD_ORDER = Object.keys(FIELD_LABELS);

const KEY_STORAGE = "ifonli:checkout-key";
const QUOTE_DEBOUNCE_MS = 300;

interface Issue {
  /** Form field path (also the input's `name`). */
  path: string;
  message: string;
}

interface ServerProblem {
  message: string;
  items?: ShortageItem[];
}

/** RHF's nested error object -> flat, DOM-ordered list of `{path, message}`. */
function flattenErrors(errors: unknown, prefix = ""): Issue[] {
  if (!errors || typeof errors !== "object") return [];
  const out: Issue[] = [];
  for (const [key, value] of Object.entries(errors as Record<string, unknown>)) {
    if (key === "ref" || key === "type" || key === "types") continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const node = value as { message?: unknown } | undefined;
    if (node && typeof node.message === "string") out.push({ path, message: node.message });
    else out.push(...flattenErrors(value, path));
  }
  return out;
}

/**
 * One idempotency key per cart version: a double click or a reload replays the same order, and a
 * changed cart (new version) starts a new attempt with a new key.
 */
function idempotencyKeyFor(cartId: string | null, version: number): string {
  const id = `${cartId ?? "-"}:${version}`;
  try {
    const raw = sessionStorage.getItem(KEY_STORAGE);
    const saved = raw ? (JSON.parse(raw) as { id?: string; key?: string }) : null;
    if (saved?.id === id && typeof saved.key === "string") return saved.key;
  } catch {
    /* storage unavailable: fall through to a fresh key */
  }
  const key = crypto.randomUUID();
  try {
    sessionStorage.setItem(KEY_STORAGE, JSON.stringify({ id, key }));
  } catch {
    /* best effort */
  }
  return key;
}

interface Totals {
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  totalPaise: number;
  taxIncludedPaise: number;
}

/** Totals to show: the live quote, adjusted at once for a payment-method switch the quote has not caught up with. */
function totalsFor(
  quote: CheckoutQuote | null,
  cart: CartView,
  method: CheckoutPaymentMethod,
): Totals {
  if (!quote) {
    const p = cart.pricing;
    return {
      subtotalPaise: p.subtotalPaise,
      discountPaise: p.discountPaise,
      shippingPaise: p.shippingPaise,
      codFeePaise: 0,
      totalPaise: p.totalPaise,
      taxIncludedPaise: p.taxIncludedPaise,
    };
  }
  const p = quote.pricing;
  const base = {
    subtotalPaise: p.subtotalPaise,
    discountPaise: p.discountPaise,
    shippingPaise: p.shippingPaise,
    taxIncludedPaise: p.taxIncludedPaise,
  };
  if (quote.paymentMethod === method)
    return { ...base, codFeePaise: p.codFeePaise, totalPaise: p.totalPaise };
  if (method === "cod" && quote.payment.cod.available) {
    return {
      ...base,
      codFeePaise: quote.payment.cod.feePaise,
      totalPaise: quote.payment.cod.totalPaise,
    };
  }
  return { ...base, codFeePaise: 0, totalPaise: quote.payment.razorpay.totalPaise };
}

function currentVibe(): string | null {
  const vibe = document.documentElement.getAttribute("data-vibe");
  return vibe && /^[a-z0-9-]+$/.test(vibe) ? vibe : null;
}

function focusFirstInvalid(form: HTMLFormElement | null) {
  const el = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
  el?.focus();
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
}

export function CheckoutForm({ initialCart, initialEmail, returnSummary }: CheckoutFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const autofilled = useRef<{ city: string | null; state: string | null }>({
    city: null,
    state: null,
  });

  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    clearErrors,
    getValues,
    formState: { errors, submitCount },
  } = useForm<CheckoutFormInput, unknown, CheckoutFormValues>({
    resolver: zodResolver(checkoutFormSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    // Focus is moved by `focusFirstInvalid` so the order is the page order, not registration order.
    shouldFocusError: false,
    defaultValues: {
      email: initialEmail ?? "",
      phone: "",
      shippingAddress: {
        pincode: "",
        city: "",
        state: "",
        name: "",
        line1: "",
        line2: "",
        landmark: "",
      },
      paymentMethod: "razorpay",
      policyAck: UNTICKED,
    },
  });

  // -- live inputs ---------------------------------------------------------------------------
  const rawPincode = (useWatch({ control, name: "shippingAddress.pincode" }) ?? "").trim();
  const paymentMethod = useWatch({ control, name: "paymentMethod" });
  const rawEmail = useWatch({ control, name: "email" }) ?? "";
  const pincode = PINCODE_PATTERN.test(rawPincode) ? rawPincode : null;
  const email = emailSchema.safeParse(rawEmail).success ? rawEmail.trim().toLowerCase() : null;

  // -- pincode lookup: autofill city / state, serviceability, COD flag ------------------------
  const [lookupState, setLookupState] = useState<{
    pincode: string;
    data: PincodeLookup | null;
  } | null>(null);
  useEffect(() => {
    if (!pincode) return;
    let cancelled = false;
    void lookupPincode({ pincode }).then((res) => {
      if (cancelled) return;
      const data = res.ok ? res.data : null;
      setLookupState({ pincode, data });
      if (!data) return;
      const fill = (field: "city" | "state", value: string | null) => {
        const path = `shippingAddress.${field}` as const;
        if (value) {
          setValue(path, value, { shouldDirty: true });
          clearErrors(path);
          autofilled.current[field] = value;
        } else if (autofilled.current[field] && getValues(path) === autofilled.current[field]) {
          // The previous pincode's autofill no longer applies.
          setValue(path, "", { shouldDirty: true });
          autofilled.current[field] = null;
        }
      };
      fill("city", data.city);
      fill("state", data.state);
    });
    return () => {
      cancelled = true;
    };
  }, [pincode, setValue, clearErrors, getValues]);
  const lookup = pincode && lookupState?.pincode === pincode ? lookupState.data : null;
  const lookupPending = pincode !== null && lookupState?.pincode !== pincode;
  const stateLocked = Boolean(lookup?.serviceable && lookup.state);

  // -- live quote: totals, delivery estimate, COD eligibility, blockers ---------------------
  // Set when COD stops being offered (new pincode, bigger cart) and the choice falls back to online payment.
  const [codDropped, setCodDropped] = useState<string | null>(null);
  const [quoteNonce, setQuoteNonce] = useState(0);
  const [placed, setPlaced] = useState<{ ref: string; email: string } | null>(null);
  const quoteKey = `${pincode ?? ""}|${paymentMethod}|${email ?? ""}|${quoteNonce}`;
  const [answered, setAnswered] = useState<{
    key: string;
    quote: CheckoutQuote | null;
    cartGone: boolean;
  } | null>(null);
  useEffect(() => {
    if (placed) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void getCheckoutQuote({
        pincode: pincode ?? undefined,
        paymentMethod,
        email: email ?? undefined,
      }).then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setAnswered({ key: quoteKey, quote: res.data, cartGone: false });
          const cod = res.data.payment.cod;
          if (
            getValues("paymentMethod") === "cod" &&
            res.data.pincode?.pincode === pincode &&
            !cod.available
          ) {
            setValue("paymentMethod", "razorpay", { shouldDirty: true });
            setCodDropped(cod.reason ?? "Cash on delivery isn't available for this order.");
          }
        } else if (res.error.code === "cart_not_found")
          setAnswered({ key: quoteKey, quote: null, cartGone: true });
        // Any other failure keeps the last good quote; the server re-prices on submit anyway.
        else
          setAnswered((prev) => ({ key: quoteKey, quote: prev?.quote ?? null, cartGone: false }));
      });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [quoteKey, pincode, paymentMethod, email, placed, getValues, setValue]);
  const quote = answered?.quote ?? null;
  const quoteFresh = answered?.key === quoteKey;
  const cart = quote?.cart ?? initialCart;
  const totals = totalsFor(quote, cart, paymentMethod);

  const quoteForPincode = quote && pincode && quote.pincode?.pincode === pincode ? quote : null;
  const codAvailable = quoteForPincode?.payment.cod.available ?? false;
  const codReason = quoteForPincode?.payment.cod.reason ?? null;
  const delivery = quoteForPincode?.delivery ?? null;

  // -- submit --------------------------------------------------------------------------------
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<ServerProblem | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const pay = usePayment();

  // Errors reach the DOM a frame after the submit handler returns, so look for them for a few frames.
  useEffect(() => {
    if (focusTick === 0) return;
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      if (formRef.current?.querySelector('[aria-invalid="true"]'))
        return focusFirstInvalid(formRef.current);
      if (tries++ < 12) frame = requestAnimationFrame(attempt);
      else summaryRef.current?.focus();
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  }, [focusTick]);

  async function onValid(values: CheckoutFormValues) {
    setProblem(null);
    if (lookup && !lookup.serviceable) {
      // The pincode field is already showing the directory's message; take the customer to it.
      setFocusTick((t) => t + 1);
      return;
    }
    setSubmitting(true);
    const result = await placeOrder({
      ...values,
      idempotencyKey: idempotencyKeyFor(cart.cartId, cart.version),
      vibe: currentVibe(),
    });

    if (!result.ok) {
      const { error } = result;
      const unmapped: string[] = [];
      if ("fieldErrors" in error && error.fieldErrors) {
        for (const [path, message] of Object.entries(error.fieldErrors)) {
          if (path in FIELD_LABELS) setError(path as "email", { type: "server", message });
          else unmapped.push(message);
        }
      }
      if ("code" in error && (error.code === "cart_not_found" || error.code === "empty_cart")) {
        setAnswered({ key: quoteKey, quote: null, cartGone: true });
      }
      const hasItems = "items" in error && error.items && error.items.length > 0;
      if (hasItems) setQuoteNonce((n) => n + 1);
      setProblem(
        hasItems || unmapped.length > 0 || !("fieldErrors" in error && error.fieldErrors)
          ? {
              message: unmapped[0] ?? error.message,
              items: "items" in error ? error.items : undefined,
            }
          : null,
      );
      setSubmitting(false);
      setFocusTick((t) => t + 1);
      return;
    }

    const { data } = result;
    const order = { ref: data.ref, token: data.accessToken };
    if (!data.requiresPayment) {
      // Cash on delivery: the order is already confirmed.
      router.replace(
        `/orders/${encodeURIComponent(order.ref)}?t=${encodeURIComponent(order.token)}`,
      );
      return;
    }
    setPlaced({ ref: data.ref, email: values.email });
    setSubmitting(false);
    if (data.payment) pay.start(data.payment, order);
    else void pay.retry(order);
  }

  function onInvalid() {
    setProblem(null);
    setFocusTick((t) => t + 1);
  }

  // -- derived view state --------------------------------------------------------------------
  const pincodeError =
    errors.shippingAddress?.pincode?.message ??
    (lookup && !lookup.serviceable
      ? (lookup.message ?? "We can't deliver to that pincode.")
      : undefined);
  const issues = flattenErrors(errors);
  if (
    pincodeError &&
    !issues.some((i) => i.path === "shippingAddress.pincode") &&
    submitCount > 0
  ) {
    issues.unshift({ path: "shippingAddress.pincode", message: pincodeError });
  }
  issues.sort((a, b) => FIELD_ORDER.indexOf(a.path) - FIELD_ORDER.indexOf(b.path));
  const showIssues = (submitCount > 0 && issues.length > 0) || problem !== null;
  const locked = placed !== null || submitting;
  const blockers = (quote?.blockers ?? []).filter((b) => !(pincode === null && /pincode/i.test(b)));

  if (!placed && (answered?.cartGone || (quote && quote.cart.lines.length === 0)))
    return <EmptyCheckout />;

  const methodLabel =
    paymentMethod === "cod"
      ? `Place COD order ${formatINR(totals.totalPaise)}`
      : `Pay ${formatINR(totals.totalPaise)} securely`;

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={handleSubmit(onValid, onInvalid)}
      aria-describedby={showIssues ? "checkout-problems" : undefined}
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start"
      data-testid="checkout-form"
    >
      <fieldset disabled={locked} className="m-0 flex min-w-0 flex-col gap-8 border-0 p-0">
        <legend className="sr-only">Checkout details</legend>

        {/* 1. Contact */}
        <section aria-labelledby="checkout-contact" className="flex flex-col gap-4">
          <h2 id="checkout-contact" className="font-display text-2xl leading-tight">
            Contact
          </h2>
          <Field
            label="Email"
            required
            hint="Your order confirmation and updates go here."
            error={errors.email?.message}
          >
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              {...register("email")}
            />
          </Field>
          <Field
            label="Mobile number"
            required
            hint="10 digits. Used only for delivery updates."
            error={errors.phone?.message}
          >
            <Input type="tel" inputMode="tel" autoComplete="tel" {...register("phone")} />
          </Field>
        </section>

        {/* 2. Delivery address */}
        <section aria-labelledby="checkout-address" className="flex flex-col gap-4">
          <h2 id="checkout-address" className="font-display text-2xl leading-tight">
            Delivery address
          </h2>
          {/* Accounts phase: a saved-address picker goes here and fills the fields below with setValue. */}
          <Field
            label="Pincode"
            required
            className="sm:max-w-xs"
            hint={
              lookupPending ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner className="size-4" /> Checking your pincode...
                </span>
              ) : lookup?.serviceable ? (
                `We deliver to ${[lookup.city, lookup.state].filter(Boolean).join(", ") || "this pincode"}.`
              ) : (
                "6 digits. We'll fill in your city and state."
              )
            }
            error={pincodeError}
          >
            <Input
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={6}
              {...register("shippingAddress.pincode", {
                onChange: (e: { target: HTMLInputElement }) => {
                  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
                },
              })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City" required error={errors.shippingAddress?.city?.message}>
              <Input autoComplete="address-level2" {...register("shippingAddress.city")} />
            </Field>
            <Field
              label="State"
              required
              hint={stateLocked ? "From your pincode." : undefined}
              error={errors.shippingAddress?.state?.message}
            >
              <Input
                autoComplete="address-level1"
                readOnly={stateLocked}
                {...register("shippingAddress.state")}
              />
            </Field>
          </div>
          <Field label="Full name" required error={errors.shippingAddress?.name?.message}>
            <Input autoComplete="name" {...register("shippingAddress.name")} />
          </Field>
          <Field
            label="House or flat number and street"
            required
            error={errors.shippingAddress?.line1?.message}
          >
            <Input autoComplete="address-line1" {...register("shippingAddress.line1")} />
          </Field>
          <Field label="Area or locality (optional)" error={errors.shippingAddress?.line2?.message}>
            <Input autoComplete="address-line2" {...register("shippingAddress.line2")} />
          </Field>
          <Field label="Landmark (optional)" error={errors.shippingAddress?.landmark?.message}>
            <Input {...register("shippingAddress.landmark")} />
          </Field>
        </section>

        {/* 3. Shipping */}
        <section aria-labelledby="checkout-shipping" className="flex flex-col gap-3">
          <h2 id="checkout-shipping" className="font-display text-2xl leading-tight">
            Shipping
          </h2>
          {!pincode ? (
            <p className="text-base text-ink-muted">
              Enter your pincode above to see delivery options.
            </p>
          ) : lookupPending || !quoteForPincode ? (
            <p
              className="inline-flex items-center gap-2 text-base text-ink-muted"
              aria-live="polite"
            >
              <Spinner /> Checking delivery to {pincode}...
            </p>
          ) : lookup && !lookup.serviceable ? (
            <p className="flex items-start gap-2 text-base font-semibold text-danger">
              <Icon name="alert-circle" className="mt-0.5 size-5 flex-none" />
              {lookup.message ?? "We can't deliver to that pincode."}
            </p>
          ) : (
            <div
              className="flex items-start gap-3 rounded-card border-token bg-surface p-4"
              data-testid="shipping-option"
            >
              <Icon name="truck" className="mt-0.5 size-6 flex-none" />
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">Standard delivery</p>
                <p className="text-sm text-ink-muted">
                  {delivery
                    ? `Estimated delivery ${formatDateRange(delivery.fromDate, delivery.toDate)}`
                    : "We'll confirm the delivery date once your order is placed."}
                </p>
              </div>
              <p className="flex-none text-base font-semibold tabular-nums">
                {totals.shippingPaise === 0 ? "Free" : formatINR(totals.shippingPaise)}
              </p>
            </div>
          )}
        </section>

        {/* 4. Payment */}
        <section aria-labelledby="checkout-payment" className="flex flex-col gap-3">
          <h2 id="checkout-payment" className="font-display text-2xl leading-tight">
            Payment
          </h2>
          <RadioGroup
            legend="Payment method"
            hideLegend
            value={paymentMethod}
            onValueChange={(value) => {
              setCodDropped(null);
              setValue("paymentMethod", value as CheckoutPaymentMethod, { shouldDirty: true });
            }}
          >
            <Radio
              value="razorpay"
              label="Pay online"
              description="UPI, cards, net banking, wallets"
            />
            {codAvailable || (paymentMethod === "cod" && !quoteForPincode) ? (
              <Radio
                value="cod"
                label="Cash on delivery"
                description={`Pay when your order arrives. A ${formatINR(quoteForPincode?.payment.cod.feePaise ?? 0)} cash on delivery fee applies.`}
              />
            ) : null}
          </RadioGroup>
          {pincode && quoteForPincode && !codAvailable && codReason ? (
            <p className="text-sm text-ink-muted" data-testid="cod-unavailable">
              Cash on delivery isn&apos;t available for this order: {codReason}
            </p>
          ) : null}
          {codDropped ? (
            <p className="text-sm font-semibold text-warning" role="status">
              We&apos;ve switched you to online payment. {codDropped}
            </p>
          ) : null}
        </section>

        {/* 5. Review (below the sections on phones, a sticky column beside them on desktop) */}
      </fieldset>

      <section
        aria-labelledby="checkout-review"
        className="flex min-w-0 flex-col gap-5 rounded-card border-token bg-surface p-4 shadow-card sm:p-5 lg:sticky lg:top-6"
        data-testid="review"
        aria-busy={!quoteFresh}
      >
        <h2 id="checkout-review" className="font-display text-2xl leading-tight">
          Review your order
        </h2>

        <OrderLines
          lines={cart.lines.map((line) => ({
            key: line.lineId,
            name: line.productName,
            variantTitle: line.variantTitle,
            qty: line.qty,
            lineTotalPaise: line.lineTotalPaise,
            imageUrl: line.image?.url ?? null,
          }))}
        />

        {cart.notices.length > 0 ? (
          <ul
            className="flex flex-col gap-1 rounded-card bg-surface-2 p-3 text-sm"
            data-testid="cart-notices"
          >
            {cart.notices.map((n, i) => (
              <li key={`${n.code}-${i}`}>{n.message}</li>
            ))}
          </ul>
        ) : null}

        <AmountBreakdown
          {...totals}
          shippingNote={pincode ? undefined : "Enter your pincode to confirm shipping."}
          className={quoteFresh ? undefined : "opacity-70"}
        />

        <p className="-mt-2 text-sm">
          <Link href="/cart" className="text-link underline underline-offset-4 hover:no-underline">
            Edit your cart
          </Link>
        </p>

        {blockers.length > 0 ? (
          <ul
            className="flex flex-col gap-1 text-sm font-semibold text-danger"
            data-testid="blockers"
          >
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-col gap-1">
          <Checkbox
            label={
              <>
                I have read and agree to the{" "}
                {POLICY_LINKS.map((p, i) => (
                  <span key={p.href}>
                    <Link
                      href={p.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-link underline underline-offset-4 hover:no-underline"
                    >
                      {p.label}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </Link>
                    {i < POLICY_LINKS.length - 2
                      ? ", "
                      : i === POLICY_LINKS.length - 2
                        ? " and "
                        : "."}
                  </span>
                ))}
              </>
            }
            description={returnSummary}
            disabled={locked}
            aria-invalid={errors.policyAck ? true : undefined}
            aria-describedby={errors.policyAck ? "policy-ack-error" : undefined}
            {...register("policyAck")}
          />
          <div aria-live="polite">
            {errors.policyAck?.message ? (
              <p
                id="policy-ack-error"
                className="flex items-start gap-1.5 text-sm font-semibold text-danger"
              >
                <Icon name="alert-circle" className="mt-0.5 size-4" />
                <span>{errors.policyAck.message}</span>
              </p>
            ) : null}
          </div>
        </div>

        {showIssues ? (
          <div
            id="checkout-problems"
            ref={summaryRef}
            tabIndex={-1}
            role="alert"
            className="flex flex-col gap-2 rounded-card border-token border-danger bg-surface p-3 text-sm outline-none"
            data-testid="error-summary"
          >
            {problem ? (
              <>
                <p className="font-bold text-danger">{problem.message}</p>
                {problem.items && problem.items.length > 0 ? (
                  <ul className="list-disc pl-5" data-testid="shortage-list">
                    {problem.items.map((item) => (
                      <li key={item.variantId}>{item.message}</li>
                    ))}
                  </ul>
                ) : null}
                {problem.items && problem.items.length > 0 ? (
                  <p>
                    <Link
                      href="/cart"
                      className="font-semibold text-link underline underline-offset-4 hover:no-underline"
                    >
                      Review your cart
                    </Link>
                  </p>
                ) : null}
              </>
            ) : null}
            {issues.length > 0 ? (
              <>
                <p className="font-bold text-danger">
                  {issues.length === 1
                    ? "There is 1 thing to fix"
                    : `There are ${issues.length} things to fix`}
                </p>
                <ul className="flex flex-col gap-1">
                  {issues.map((issue) => (
                    <li key={issue.path}>
                      <button
                        type="button"
                        className="min-h-11 text-left text-link underline underline-offset-4 hover:no-underline"
                        onClick={() => {
                          const el = formRef.current?.querySelector<HTMLElement>(
                            `[name="${issue.path}"]`,
                          );
                          el?.focus();
                          el?.scrollIntoView({ block: "center", behavior: "smooth" });
                        }}
                      >
                        <span className="font-semibold">{FIELD_LABELS[issue.path] ?? "Form"}:</span>{" "}
                        {issue.message}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}

        {placed ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted">
              Order <strong className="text-ink">{placed.ref}</strong> is waiting for payment.
              {pay.orderUrl ? (
                <>
                  {" "}
                  <Link
                    href={pay.orderUrl}
                    className="text-link underline underline-offset-4 hover:no-underline"
                  >
                    View order
                  </Link>
                </>
              ) : null}
            </p>
            <PaymentStatusPanel
              phase={pay.phase}
              onRetry={() => void pay.retry()}
              orderUrl={pay.orderUrl}
              email={placed.email}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              type="submit"
              size="lg"
              fullWidth
              loading={submitting}
              data-testid="place-order"
            >
              {methodLabel}
            </Button>
            <p className="text-center text-sm text-ink-muted">
              {paymentMethod === "cod"
                ? "You'll pay when your order is delivered."
                : "You'll pay in a secure payment window on the next step."}
            </p>
          </div>
        )}
        {pay.mockDialog}
      </section>
    </form>
  );
}
