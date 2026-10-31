import type { Metadata } from "next";

import { requireCustomer } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listAddresses } from "@/server/services/account";

import { AddressManager } from "./AddressManager";

/** Session-gated and dynamic: exempt from instant-navigation validation (see the area layout). */
export const instant = false;

export const metadata: Metadata = { title: "Your addresses" };

export default async function AddressesPage() {
  const { user } = await requireCustomer({ next: "/account/addresses" });
  const addresses = await listAddresses(getDb(), user.id);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl leading-tight display-fx sm:text-4xl">Your addresses</h1>
        <p className="text-base text-ink-muted">Save where you like things delivered. One of them is your default.</p>
      </header>
      <AddressManager addresses={addresses} />
    </div>
  );
}
