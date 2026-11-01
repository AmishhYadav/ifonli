import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

import { DeletedCleanup } from "./DeletedCleanup";

export const metadata: Metadata = {
  title: "Account deleted",
  robots: { index: false, follow: false },
};

/** Where the "Delete my account" action lands. Static: the session is already gone. */
export default function AccountDeletedPage() {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-12 sm:px-6">
      <DeletedCleanup />
      <h1 className="font-display text-4xl leading-tight display-fx">Your account is deleted</h1>
      <p className="flex items-start gap-2 text-base">
        <Icon name="check" className="mt-0.5 size-5 flex-none" />
        We&apos;ve removed your sign-in, profile, addresses and wishlist. Your past orders stay on record for
        tax purposes, and you can still follow any order that is on its way on the tracking page.
      </p>
      <p className="text-base text-ink-muted">
        You&apos;re always welcome back, and guest checkout works without an account.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/shop">Back to the shop</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/track">Track an order</Link>
        </Button>
      </div>
    </div>
  );
}
