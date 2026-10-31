"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button, Field, Icon, Input } from "@/components/ui";
import {
  sendLoginCode,
  verifyLoginCode,
  type AuthErrorCode,
} from "@/features/account/auth-actions";
import { connectAccountWishlist } from "@/features/wishlist/account-sync";

interface LoginFlowProps {
  /** `?email=` prefill (for example from the order confirmation). */
  initialEmail: string;
  /** Already-sanitised destination after sign-in. */
  next: string;
}

interface Problem {
  code: AuthErrorCode;
  message: string;
}

/**
 * Two steps on one page: e-mail -> six-digit code. Passwordless, so the same flow signs in and
 * creates the account. Copy is plain and neutral on purpose (no vibe voice on sign-in).
 */
export function LoginFlow({ initialEmail, next }: LoginFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [pending, startTransition] = useTransition();
  const [resent, setResent] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);

  // Resend countdown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step]);

  function send(isResend: boolean) {
    setProblem(null);
    setResent(false);
    startTransition(async () => {
      const res = await sendLoginCode({ email });
      if (!res.ok) {
        setProblem({ code: res.code, message: res.error });
        if (res.retryAfterSeconds && step === "code")
          setCooldown(Math.min(res.retryAfterSeconds, 60));
        if (step === "email") emailInput.current?.focus();
        return;
      }
      setCooldown(res.data.cooldownSeconds);
      setCode("");
      setStep("code");
      setResent(isResend);
    });
  }

  function verify() {
    setProblem(null);
    startTransition(async () => {
      const res = await verifyLoginCode({ email, code, next });
      if (!res.ok) {
        setProblem({ code: res.code, message: res.error });
        if (res.code === "wrong_code") {
          setCode("");
          codeInput.current?.focus();
        }
        return;
      }
      // Pull the account wishlist, merge it into this device's list and push the result back.
      await connectAccountWishlist();
      router.replace(res.data.next);
      router.refresh();
    });
  }

  const needsNewCode = problem?.code === "expired" || problem?.code === "too_many_attempts";

  return (
    <div
      className="rounded-card border-token bg-surface p-5 shadow-card sm:p-6"
      data-testid="login-flow"
    >
      {step === "email" ? (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            send(false);
          }}
        >
          <Field
            label="Email"
            hint="We'll email you a 6-digit code. No password needed."
            error={problem?.message}
          >
            <Input
              ref={emailInput}
              type="email"
              name="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus={initialEmail === ""}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
            />
          </Field>
          {problem?.code === "admin_account" ? (
            <p className="text-sm text-ink-muted">
              <Link
                href="/admin/login"
                className="text-link underline underline-offset-4 hover:no-underline"
              >
                Go to the admin sign-in
              </Link>
            </p>
          ) : null}
          <Button type="submit" loading={pending} iconStart="mail" disabled={email.trim() === ""}>
            Email me a code
          </Button>
        </form>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            verify();
          }}
        >
          <p className="text-base" data-testid="code-sent">
            We sent a 6-digit code to{" "}
            <strong className="break-all">{email.trim().toLowerCase()}</strong>. It works for 10
            minutes.
          </p>
          {resent ? (
            <p
              role="status"
              className="flex items-center gap-1.5 text-sm font-semibold text-success"
            >
              <Icon name="check" className="size-4" />A new code is on its way.
            </p>
          ) : null}
          <Field label="Sign-in code" error={problem?.message}>
            <Input
              ref={codeInput}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="text-center text-2xl tracking-[0.4em] tabular-nums"
              placeholder="000000"
            />
          </Field>
          {problem?.code === "admin_account" ? (
            <Link
              href="/admin/login"
              className="text-link underline underline-offset-4 hover:no-underline"
            >
              Go to the admin sign-in
            </Link>
          ) : null}
          <Button type="submit" loading={pending} disabled={code.length !== 6 || needsNewCode}>
            Sign in
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <Button
              variant="link"
              size="sm"
              disabled={pending || cooldown > 0}
              onClick={() => send(true)}
              data-testid="resend"
            >
              {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
            </Button>
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                setStep("email");
                setCode("");
                setProblem(null);
              }}
            >
              Use a different email
            </Button>
          </div>
        </form>
      )}
      <p className="mt-4 text-sm text-ink-muted">
        New here? Entering your email creates your account. We only use it for your orders and the
        updates you choose.
      </p>
    </div>
  );
}
