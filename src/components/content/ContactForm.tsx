"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { sendContactMessage } from "@/app/(store)/help/actions";
import {
  INITIAL_CONTACT_STATE,
  type ContactFormField,
  type ContactFormState,
} from "@/app/(store)/help/types";
import { Button, Field, Icon, Input, Textarea } from "@/components/ui";

const MESSAGE_MAX = 2000;
const ORDER_FIELDS: ContactFormField[] = ["name", "email", "phone", "orderRef", "message"];

/** Contact form on the help page (Server Action). Errors move focus to the first bad field; success replaces the form. */
export function ContactForm() {
  const [state, action, pending] = useActionState(sendContactMessage, INITIAL_CONTACT_STATE);
  const [values, setValues] = useState<ContactFormState["values"]>(state.values);
  // The state object `Send another message` was clicked on; a newer answer shows again.
  const [dismissed, setDismissed] = useState<ContactFormState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const sentRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.status === "invalid") {
      const first = ORDER_FIELDS.find((f) => state.fieldErrors?.[f]);
      if (first) (formRef.current?.elements.namedItem(first) as HTMLElement | null)?.focus();
    } else if (state.status === "sent") sentRef.current?.focus();
    else if (state.status === "rate_limited" || state.status === "error") alertRef.current?.focus();
  }, [state]);

  // A new server answer carries the submitted values; mirror them so inputs stay controlled.
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    setValues(state.values);
  }

  const set = (field: ContactFormField) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));
  const errors = state.status === "invalid" ? state.fieldErrors : undefined;

  if (state.status === "sent" && dismissed !== state) {
    return (
      <div
        role="status"
        data-testid="contact-sent"
        className="flex flex-col gap-3 rounded-card border-token bg-surface p-5 text-ink shadow-card sm:p-6"
      >
        <h3
          ref={sentRef}
          tabIndex={-1}
          className="flex items-center gap-2 font-display text-xl leading-tight outline-none"
        >
          <Icon name="check" className="size-5 text-success" />
          Message sent
        </h3>
        <p className="text-base text-ink-muted">
          Thank you. We have emailed you a confirmation and will reply by email.
        </p>
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setValues(INITIAL_CONTACT_STATE.values);
              setDismissed(state);
            }}
          >
            Send another message
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={action}
      noValidate
      data-testid="contact-form"
      className="flex flex-col gap-4 rounded-card border-token bg-surface p-4 shadow-card sm:p-5"
    >
      {state.status === "rate_limited" || state.status === "error" ? (
        <p
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-2 rounded-input border-token border-danger p-3 text-base font-semibold text-danger outline-none"
        >
          <Icon name="alert-circle" className="mt-0.5 size-5 flex-none" />
          {state.message}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" required error={errors?.name}>
          <Input
            name="name"
            value={values.name}
            onChange={set("name")}
            autoComplete="name"
            maxLength={120}
          />
        </Field>
        <Field label="Email" required error={errors?.email}>
          <Input
            name="email"
            type="email"
            value={values.email}
            onChange={set("email")}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
          />
        </Field>
        <Field label="Mobile number" hint="Optional. Only if you would like a call." error={errors?.phone}>
          <Input
            name="phone"
            type="tel"
            inputMode="tel"
            value={values.phone}
            onChange={set("phone")}
            autoComplete="tel"
            maxLength={20}
            placeholder="98765 43210"
          />
        </Field>
        <Field label="Order reference" hint="Optional, from your confirmation email." error={errors?.orderRef}>
          <Input
            name="orderRef"
            value={values.orderRef}
            onChange={set("orderRef")}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={40}
            placeholder="IFO-2611-7K3Q"
          />
        </Field>
      </div>
      <Field
        label="How can we help?"
        required
        hint={`${values.message.length}/${MESSAGE_MAX} characters`}
        error={errors?.message}
      >
        <Textarea
          name="message"
          rows={5}
          value={values.message}
          onChange={set("message")}
          maxLength={MESSAGE_MAX}
        />
      </Field>
      {/* Honeypot: off-screen and skipped by keyboards and screen readers. Bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Leave this field empty
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <div>
        <Button type="submit" loading={pending} iconStart="mail">
          Send message
        </Button>
      </div>
    </form>
  );
}
