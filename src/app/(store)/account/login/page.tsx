import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { LoginFlow } from "@/components/account/LoginFlow";
import { Skeleton } from "@/components/ui";
import { emailSchema } from "@/features/checkout/schema";
import { safeNextPath } from "@/features/account/schema";
import { isAdminRole } from "@/server/auth/permissions";
import { getSession } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in or create your IfOnli account with a code sent to your email.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function LoginContent({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const next = safeNextPath(first(query.next));
  const email = emailSchema.safeParse(first(query.email));

  // Already signed in as a customer: go where they were headed. (An admin session stays here, so the
  // form can say where admins sign in.)
  const session = await getSession();
  if (session && !isAdminRole((session.user as { role?: string }).role)) redirect(next);

  return <LoginFlow initialEmail={email.success ? email.data : ""} next={next} />;
}

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="font-display text-4xl leading-tight display-fx">
        Sign in or create an account
      </h1>
      <p className="mt-2 mb-6 text-lg text-ink-muted">
        See your orders, keep your addresses and your wishlist on every device.
      </p>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
