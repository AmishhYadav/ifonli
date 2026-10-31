import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Card, CardTitle } from "@/components/ui";
import { requireCustomer } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getProfile } from "@/server/services/account";

import { PrivacyPanel } from "./PrivacyPanel";
import { ProfileForm } from "./ProfileForm";

/** Session-gated and dynamic: exempt from instant-navigation validation (see the area layout). */
export const instant = false;

export const metadata: Metadata = { title: "Profile and privacy" };

export default async function ProfilePage() {
  const { user } = await requireCustomer({ next: "/account/profile" });
  const profile = await getProfile(getDb(), user.id);
  if (!profile) notFound();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl leading-tight display-fx sm:text-4xl">Profile and privacy</h1>
      </header>
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Card as="section" aria-labelledby="profile-heading">
          <CardTitle id="profile-heading" as="h2" className="mb-4">
            Your details
          </CardTitle>
          <ProfileForm initial={profile} />
        </Card>
        <PrivacyPanel />
      </div>
    </div>
  );
}
