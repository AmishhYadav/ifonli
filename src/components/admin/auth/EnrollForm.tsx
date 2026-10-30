"use client";

import { Copy, Loader2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import {
  finishEnrollmentAction,
  signOutAction,
  startEnrollmentAction,
  type EnrollmentStart,
} from "@/app/admin/(auth)/actions";
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

export function EnrollForm({
  email: initialEmail,
  enrolled,
}: {
  email: string;
  enrolled: boolean;
}) {
  const router = useRouter();
  // Props change when the page re-renders after an action; the address shown must not.
  const [email] = React.useState(initialEmail);
  const [stage, setStage] = React.useState<"password" | "scan" | "backup">("password");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [setup, setSetup] = React.useState<EnrollmentStart | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  // Set once the user submits the final code: the new session re-renders this page as "enrolled"
  // while the backup codes are still being shown, which must not bounce them to the dashboard.
  const finishing = React.useRef(false);

  React.useEffect(() => {
    if (enrolled && !finishing.current && stage !== "backup") router.replace("/admin");
  }, [enrolled, stage, router]);

  function start(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await startEnrollmentAction({ password });
      if (!res.ok) return setError(res.error);
      setSetup(res.data);
      setPassword("");
      setStage("scan");
    });
  }

  function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    finishing.current = true;
    startTransition(async () => {
      const res = await finishEnrollmentAction({ code: code.replace(/\s/g, "") });
      if (!res.ok) {
        finishing.current = false;
        return setError(res.error);
      }
      setStage("backup");
    });
  }

  if (stage === "backup" && setup) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Save your backup codes</CardTitle>
          <CardDescription>
            Each code works once if you lose your phone. Store them somewhere safe; they are not
            shown again.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="tabular grid grid-cols-2 gap-1.5 rounded-md bg-admin-surface-2 p-3 font-mono text-[13px]">
            {setup.backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(setup.backupCodes.join("\n"));
              toast.success("Backup codes copied");
            }}
          >
            <Copy aria-hidden /> Copy codes
          </Button>
          <Button
            onClick={() => {
              router.replace("/admin");
              router.refresh();
            }}
          >
            I have saved them, continue
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Set up two-factor sign-in</CardTitle>
        <CardDescription>
          Admin accounts need an authenticator app (Google Authenticator, 1Password, Authy). Signed
          in as {email}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {stage === "password" ? (
          <form onSubmit={start} className="flex flex-col gap-4" noValidate>
            <Field
              label="Confirm your password"
              htmlFor="password"
              hint="We ask again before showing the setup key."
              error={error ?? undefined}
            >
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!error}
              />
            </Field>
            <Button type="submit" disabled={pending || !password}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Show QR code
            </Button>
          </form>
        ) : setup ? (
          <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
            <ol className="list-inside list-decimal text-[13px] text-admin-ink-muted">
              <li>Scan this QR code with your authenticator app.</li>
              <li>Enter the 6-digit code it shows.</li>
            </ol>
            <div className="mx-auto rounded-lg border border-admin-border bg-white p-2">
              <Image
                src={setup.qrDataUrl}
                alt="Authenticator QR code"
                width={224}
                height={224}
                unoptimized
              />
            </div>
            <details className="text-xs text-admin-ink-muted">
              <summary className="cursor-pointer">Can&apos;t scan? Enter the key manually</summary>
              <code className="mt-2 block rounded-md bg-admin-surface-2 p-2 font-mono text-[13px] break-all text-admin-ink select-all">
                {setup.secret}
              </code>
            </details>
            <Field label="6-digit code" htmlFor="code" error={error ?? undefined}>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                aria-invalid={!!error}
                className="tabular tracking-widest"
                placeholder="123456"
              />
            </Field>
            <Button type="submit" disabled={pending || code.trim().length < 6}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Verify and turn on
            </Button>
          </form>
        ) : null}
        <form action={signOutAction} className="mt-4 text-center">
          <button type="submit" className="text-xs text-admin-ink-muted hover:underline">
            Sign out
          </button>
        </form>
      </CardContent>
    </Card>
  );
}
