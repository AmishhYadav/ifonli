import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { safeNextPath } from "@/features/account/redirect";
import { emailSchema } from "@/features/checkout/schema";
import { getOptionalCustomer, getSession } from "@/server/auth/session";

import { LoginForm } from "./LoginForm";

/** Session-gated and dynamic: exempt from instant-navigation validation (the shell is a skeleton). */
export const instant = false;

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function LoginContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const next = safeNextPath(first(query.next));
  const prefill = emailSchema.safeParse(first(query.email) ?? "");

  const customer = await getOptionalCustomer();
  if (customer) redirect(next);
  if (await getSession()) {
    // A staff session: the customer area is not for staff accounts.
    return (
      <div className="flex flex-col gap-4 rounded-card border-token bg-surface p-5">
        <p className="text-base">
          You&apos;re signed in with a staff account, which can&apos;t be used for shopping accounts.
        </p>
        <div>
          <Button asChild>
            <Link href="/admin">Go to the admin</Link>
          </Button>
        </div>
      </div>
    );
  }
  return <LoginForm initialEmail={prefill.success ? prefill.data : ""} next={next} />;
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl leading-tight display-fx">Sign in</h1>
        <p className="text-base text-ink-muted">
          See your orders, save addresses and keep your wishlist on every device. You don&apos;t need
          an account to shop: guest checkout always works.
        </p>
      </header>
      <Suspense fallback={<Skeleton className="h-56 w-full" />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
      <p className="text-sm text-ink-muted">
        How we use your details is in our{" "}
        <Link href="/policies/privacy" className="text-link underline underline-offset-4 hover:no-underline">
          privacy policy
        </Link>{" "}
        and{" "}
        <Link href="/policies/terms" className="text-link underline underline-offset-4 hover:no-underline">
          terms
        </Link>
        .
      </p>
    </div>
  );
}
