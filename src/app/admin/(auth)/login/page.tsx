import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/admin/auth/LoginForm";
import { isAdminRole } from "@/server/auth/permissions";
import { getSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginForm />}>
      <LoginGate />
    </Suspense>
  );
}

/** Already signed in as an admin: skip the form (the admin layout sends un-enrolled admins to enrolment). */
async function LoginGate() {
  const session = await getSession();
  if (session && isAdminRole((session.user as { role?: string }).role)) redirect("/admin");
  return <LoginForm />;
}
