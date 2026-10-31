import type { Metadata } from "next";

import { AddressBook } from "@/components/account/AddressBook";
import { requireCustomer } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listAddresses, listStateNames } from "@/server/services/accounts";

export const metadata: Metadata = { title: "Your addresses" };

export default async function AddressesPage() {
  const { user } = await requireCustomer();
  const db = getDb();
  const [addresses, states] = await Promise.all([listAddresses(db, user.id), listStateNames(db)]);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl leading-tight display-fx sm:text-4xl">Your addresses</h1>
      <AddressBook addresses={addresses} states={states} />
    </div>
  );
}
