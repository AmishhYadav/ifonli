import { Suspense } from "react";

import { AccountNav } from "@/components/account/AccountNav";
import { SignOutButton } from "@/components/account/SignOutButton";
import { Skeleton } from "@/components/ui";
import { requireCustomer } from "@/server/auth/session";

/**
 * Signed-in account shell. The session is read behind Suspense (Cache Components: request data
 * cannot be part of the static shell). `requireCustomer()` sends a missing session to the login page
 * and an admin-role session to a notice; every page and Server Action re-checks it.
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Suspense fallback={<AccountSkeleton />}>
        <Shell>{children}</Shell>
      </Suspense>
    </div>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  const { user } = await requireCustomer();
  return (
    <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-10">
      <aside className="flex flex-col gap-4">
        <div>
          <p className="font-display text-2xl leading-tight">Your account</p>
          <p className="text-sm break-all text-ink-muted" data-testid="account-email">
            {user.email}
          </p>
        </div>
        <AccountNav />
        <div>
          <SignOutButton />
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading your account"
      className="flex flex-col gap-4"
    >
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
