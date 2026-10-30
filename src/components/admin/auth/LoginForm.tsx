"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { signInAction, verifyTotpAction } from "@/app/admin/(auth)/actions";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
} from "@/components/admin/ui";

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = React.useState<"credentials" | "totp">("credentials");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [backup, setBackup] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await signInAction({ email, password });
      if (!res.ok) return setError(res.error);
      if (res.data.next === "enroll") {
        router.replace("/admin/enroll-2fa");
      } else {
        setStep("totp");
      }
    });
  }

  function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await verifyTotpAction({ code: code.replace(/\s/g, ""), backup });
      if (!res.ok) return setError(res.error);
      router.replace("/admin");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {step === "credentials" ? "Sign in" : "Two-factor code"}
        </CardTitle>
        <CardDescription>
          {step === "credentials"
            ? "Use your admin email and password."
            : backup
              ? "Enter one of your saved backup codes."
              : "Enter the 6-digit code from your authenticator app."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {step === "credentials" ? (
          <form onSubmit={submitCredentials} className="flex flex-col gap-4" noValidate>
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="username"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Password" htmlFor="password" error={error ?? undefined}>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!error}
              />
            </Field>
            <Button type="submit" disabled={pending || !email || !password}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Continue
            </Button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="flex flex-col gap-4" noValidate>
            <Field
              label={backup ? "Backup code" : "Authenticator code"}
              htmlFor="code"
              error={error ?? undefined}
            >
              <Input
                id="code"
                inputMode={backup ? "text" : "numeric"}
                autoComplete="one-time-code"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                aria-invalid={!!error}
                className="tabular tracking-widest"
                placeholder={backup ? "xxxxx-xxxxx" : "123456"}
              />
            </Field>
            <Button type="submit" disabled={pending || code.trim().length < 6}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Sign in
            </Button>
            <div className="flex justify-between text-xs">
              <button
                type="button"
                className="text-admin-primary hover:underline"
                onClick={() => {
                  setBackup((b) => !b);
                  setCode("");
                  setError(null);
                }}
              >
                {backup ? "Use authenticator code" : "Use a backup code"}
              </button>
              <button
                type="button"
                className="text-admin-ink-muted hover:underline"
                onClick={() => {
                  setStep("credentials");
                  setPassword("");
                  setCode("");
                  setError(null);
                }}
              >
                Back
              </button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
