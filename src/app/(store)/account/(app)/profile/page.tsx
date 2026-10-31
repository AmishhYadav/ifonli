import type { Metadata } from "next";

import { ProfileForm } from "@/components/account/ProfileForm";
import { requireCustomer } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getCustomerProfile } from "@/server/services/accounts";

export const metadata: Metadata = { title: "Your profile" };

export default async function ProfilePage() {
  const { user } = await requireCustomer();
  const profile = await getCustomerProfile(getDb(), user.id);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl leading-tight display-fx sm:text-4xl">Your profile</h1>
      <ProfileForm
        email={user.email}
        initial={{
          name: profile?.name ?? "",
          phone: profile?.phone ?? null,
          marketingOptIn: profile?.marketingOptIn ?? false,
        }}
      />
    </div>
  );
}
