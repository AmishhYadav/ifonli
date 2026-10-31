"use client";

import { useActionState, useEffect, useRef } from "react";

import { Button, Field, Icon, Input } from "@/components/ui";

import { loginAction } from "./actions";
import { initialLoginState } from "./types";

/**
 * Two-step passwordless login: e-mail address, then the 6-digit code. One server action drives both
 * steps; focus moves to the new step's field (or the first problem) so keyboard and screen-reader
 * users land where they need to be.
 */
export function LoginForm({ initialEmail, next }: { initialEmail: string; next: string }) {
  const [state, action, pending] = useActionState(loginAction, initialLoginState(initialEmail, next));
  const emailRef = useRef<HTMLInputElement>(null);
  const otpRef = useRef<HTMLInputElement>(null);
  const first = useRef(true);

  useEffect(() => {
    // Do not steal focus on first paint; only react to answers from the server.
    if (first.current) {
      first.current = false;
      return;
    }
    if (state.step === "code") otpRef.current?.focus();
    else emailRef.current?.focus();
  }, [state]);

  const codeStep = state.step === "code";

  return (
    <form
      action={action}
      noValidate
      className="flex flex-col gap-4 rounded-card border-token bg-surface p-4 shadow-card sm:p-6"
      data-testid="login-form"
    >
      <input type="hidden" name="next" value={state.next} />

      {codeStep ? (
        <>
          <input type="hidden" name="email" value={state.email} />
          {state.info ? (
            <p className="flex items-start gap-2 text-base" role="status" data-testid="login-info">
              <Icon name="mail" className="mt-0.5 size-5 flex-none" />
              {state.info}
            </p>
          ) : null}
          <Field
            label="6-digit code"
            required
            hint="Check your inbox (and spam folder). The code works once."
            error={state.errorField === "otp" || !state.errorField ? state.error : undefined}
          >
            <Input
              ref={otpRef}
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              spellCheck={false}
              className="tracking-[0.4em] tabular-nums"
              data-testid="login-otp"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" name="intent" value="verify" loading={pending} data-testid="login-verify">
              Sign in
            </Button>
            <Button type="submit" name="intent" value="send" variant="secondary" disabled={pending}>
              Send a new code
            </Button>
            <Button type="submit" name="intent" value="change" variant="link" disabled={pending}>
              Use a different email
            </Button>
          </div>
        </>
      ) : (
        <>
          <Field
            label="Email"
            required
            hint="We'll email you a 6-digit code. No password to remember."
            error={state.error}
          >
            <Input
              ref={emailRef}
              type="email"
              name="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={254}
              defaultValue={state.email}
              data-testid="login-email"
            />
          </Field>
          <div>
            <Button type="submit" name="intent" value="send" loading={pending} iconEnd="arrow-right" data-testid="login-send">
              Email me a code
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
