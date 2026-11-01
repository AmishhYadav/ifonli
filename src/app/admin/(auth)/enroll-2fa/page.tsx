import type { Metadata } from "next";
import { Suspense } from "react";

import { EnrollForm } from "@/components/admin/auth/EnrollForm";
import { getPasswordChangeState } from "@/server/auth/admin-user";
import { getEnrollmentSession } from "@/server/auth/session";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Set up two-factor" };

export default function EnrollPage() {
  return (
    <Suspense fallback={null}>
      <EnrollGate />
    </Suspense>
  );
}

async function EnrollGate() {
  const session = await getEnrollmentSession();
  // A temporary password (new account, owner reset) has to be replaced while enrolling.
  const mustChangePassword =
    session !== null &&
    (await getPasswordChangeState(getDb(), session.user.id)).state === "required";
  return (
    <EnrollForm
      email={session?.user.email ?? ""}
      enrolled={session?.user.twoFactorEnabled === true}
      mustChangePassword={mustChangePassword}
    />
  );
}
