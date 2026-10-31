import type { Metadata } from "next";
import Link from "next/link";

import { Button, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Staff account" };

/** Where an admin-role session lands if it opens /account: a notice, never customer data. */
export default function AdminSessionNotice() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <h1 className="sr-only">Staff account</h1>
      <EmptyState
        icon="lock"
        headingLevel="h2"
        title="You're signed in as staff"
        action={
          <Button asChild>
            <Link href="/admin">Go to the admin</Link>
          </Button>
        }
      >
        Staff accounts don&apos;t have a shopper account. Sign out of the admin to sign in as a
        customer with a different email.
      </EmptyState>
    </div>
  );
}
