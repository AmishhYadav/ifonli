"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui";
import { signOutCustomer } from "@/features/account/auth-actions";
import { goDeviceOnly } from "@/features/wishlist/account-sync";

/** Signs out on the server, and puts the device wishlist back to device-only first. */
export function SignOutButton({ className }: { className?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      iconStart="lock"
      loading={pending}
      className={className}
      onClick={() => {
        goDeviceOnly();
        startTransition(async () => {
          await signOutCustomer();
        });
      }}
    >
      Sign out
    </Button>
  );
}
