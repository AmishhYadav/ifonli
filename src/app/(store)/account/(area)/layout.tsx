import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/Skeleton";
import { getOptionalCustomer } from "@/server/auth/session";

import { AccountNav } from "./AccountNav";

/** Session-gated and dynamic: exempt from instant-navigation validation (a static shell would be a skeleton). */
export const instant = false;

/** Every account page: private, never indexed (robots.txt also disallows /account). */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

function AreaSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading your account" className="flex flex-col gap-4">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/**
 * Chrome of the signed-in area. It only decorates: it shows the section nav when a customer session
 * exists and otherwise renders the page, which does its own `requireCustomer({ next })` and sends the
 * visitor to /account/login with the right way back. Pages and Server Actions are the real gate.
 */
async function Shell({ children }: { children: React.ReactNode }) {
  const customer = await getOptionalCustomer();
  if (!customer) return <>{children}</>;
  return (
    <div className="flex flex-col gap-6">
      <AccountNav />
      {children}
    </div>
  );
}

export default function AccountAreaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6">
      <Suspense fallback={<AreaSkeleton />}>
        <Shell>{children}</Shell>
      </Suspense>
    </div>
  );
}
