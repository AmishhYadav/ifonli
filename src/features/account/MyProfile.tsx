"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";

import { TrackForm } from "@/app/(buy)/track/TrackForm";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardTitle } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/Skeleton";

import {
  checkContact,
  checkName,
  clearProfile,
  saveProfile,
  useProfile,
  useRememberedOrders,
  type ProfileDetails,
} from "./profile-store";

/** The first screen: two friendly questions, no password and no email code. */
function DetailsForm({ initial }: { initial?: ProfileDetails }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [contact, setContact] = useState(initial?.contact ?? "");
  const [errors, setErrors] = useState<{ name?: string; contact?: string }>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checkedName = checkName(name);
    const checkedContact = checkContact(contact);
    const next = {
      name: "error" in checkedName ? checkedName.error : undefined,
      contact: "error" in checkedContact ? checkedContact.error : undefined,
    };
    setErrors(next);
    if ("error" in checkedName || "error" in checkedContact) return;
    saveProfile({ name: checkedName.value, contact: checkedContact.value });
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      data-testid="profile-form"
      className="mx-auto flex w-full max-w-lg flex-col gap-5 rounded-card bg-surface p-5 shadow-card sm:p-7"
    >
      <Field label="What should we call you?" required error={errors.name}>
        <Input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter your name"
          autoComplete="name"
          maxLength={120}
        />
      </Field>
      <Field label="How do we contact you?" required error={errors.contact}>
        <Input
          name="contact"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Enter your phone number or email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
        />
      </Field>
      <div>
        <Button type="submit" size="lg" iconEnd="arrow-right">
          Continue
        </Button>
      </div>
      <p className="text-sm text-ink-muted">
        We keep these on this device only, so we can fill them in for you next time.
      </p>
    </form>
  );
}

/** Orders this browser has opened with their own link (the confirmation page, or the link in the order email). */
function OrdersCard() {
  const orders = useRememberedOrders();
  return (
    <Card as="section" aria-labelledby="my-orders">
      <CardTitle id="my-orders" as="h2" className="mb-3">
        Your orders
      </CardTitle>
      {orders.length > 0 ? (
        <ul className="flex flex-col divide-y divide-hairline" data-testid="remembered-orders">
          {orders.map((order) => (
            <li key={order.ref} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="font-semibold">{order.ref}</span>
              <Link
                href={order.href}
                className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-link underline underline-offset-4 hover:no-underline"
              >
                View order and tracking
                <Icon name="arrow-right" className="size-4" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <CardBody>
          <p className="text-ink-muted">
            Orders you place on this device show up here. For any other order, use the tracker below with its
            reference.
          </p>
          <div>
            <Button asChild variant="secondary" size="sm">
              <Link href="/shop">Start shopping</Link>
            </Button>
          </div>
        </CardBody>
      )}
    </Card>
  );
}

function PersonalSection({ profile }: { profile: ProfileDetails }) {
  const [editing, setEditing] = useState(false);
  const firstName = profile.name.split(/\s+/)[0] ?? profile.name;
  const trackingId = useId();

  if (editing) {
    return (
      <div className="flex flex-col gap-4">
        <DetailsForm initial={profile} />
        <div className="text-center">
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="profile-section">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-3xl leading-tight display-fx sm:text-4xl" data-testid="profile-greeting">
            Hi, {firstName}
          </h2>
          <p className="text-base text-ink-muted">We&apos;ll reach you on {profile.contact}.</p>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" iconStart="edit" onClick={() => setEditing(true)}>
            Edit details
          </Button>
          <Button variant="ghost" size="sm" onClick={clearProfile}>
            Not you?
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex flex-col gap-6">
          <OrdersCard />
          <section aria-labelledby={trackingId} className="flex flex-col gap-3">
            <div>
              <h2 id={trackingId} className="font-display text-xl leading-tight">
                Track an order
              </h2>
              <p className="mt-1 text-base text-ink-muted">
                Enter the order reference from your confirmation message to see where it is.
              </p>
            </div>
            <TrackForm initialContact={profile.contact} />
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <Card as="section" aria-labelledby="return-ritual">
            <CardTitle id="return-ritual" as="h2" className="mb-2">
              Return Ritual
            </CardTitle>
            <CardBody>
              <p className="text-ink-muted">How returns, replacements and refunds work, in plain words.</p>
              <div>
                <Button asChild variant="secondary" size="sm">
                  <Link href="/policies/returns-refunds">Read the Return Ritual</Link>
                </Button>
              </div>
            </CardBody>
          </Card>
          <Card as="section" aria-labelledby="order-help">
            <CardTitle id="order-help" as="h2" className="mb-2">
              Order help
            </CardTitle>
            <CardBody>
              <p className="text-ink-muted">
                Something wrong with an order, or a question about shipping? Tell us and we&apos;ll sort it out.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="secondary" size="sm">
                  <Link href="/help">Contact us</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/policies/shipping">Shipping</Link>
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** My Profile: asks for a name and contact once, then shows the personal section. */
export function MyProfile() {
  const profile = useProfile();

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-8 flex flex-col gap-2 text-center sm:mb-10">
        <h1 className="font-display text-4xl leading-tight display-fx sm:text-5xl" data-testid="account-heading">
          My Profile
        </h1>
        {profile === null ? <p className="text-base text-ink-muted">A quick hello, and you&apos;re in.</p> : null}
      </header>

      {profile === undefined ? (
        <div role="status" aria-busy="true" aria-label="Loading your profile" className="mx-auto max-w-lg">
          <Skeleton className="h-64 w-full" />
        </div>
      ) : profile === null ? (
        <DetailsForm />
      ) : (
        <PersonalSection profile={profile} />
      )}

      <p className="profile-thanks mt-14 flex items-center justify-center gap-2 text-center" data-testid="profile-thanks">
        <Icon name="sparkle" className="size-4"/>
        Thank you for choosing us.
        <Icon name="sparkle" className="size-4"/>
      </p>
    </div>
  );
}
