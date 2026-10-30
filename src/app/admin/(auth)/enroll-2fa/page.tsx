import type { Metadata } from "next";
import { Suspense } from "react";

import { EnrollForm } from "@/components/admin/auth/EnrollForm";
import { getEnrollmentSession } from "@/server/auth/session";

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
  return (
    <EnrollForm
      email={session?.user.email ?? ""}
      enrolled={session?.user.twoFactorEnabled === true}
    />
  );
}
