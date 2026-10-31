import type { Metadata } from "next";
import Link from "next/link";

import { DeleteAccountForm } from "@/components/account/PrivacyActions";
import { Button, Card, CardBody, CardTitle } from "@/components/ui";
import { requireCustomer } from "@/server/auth/session";

export const metadata: Metadata = { title: "Privacy and data" };

export default async function PrivacyPage() {
  await requireCustomer();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl leading-tight display-fx sm:text-4xl">
        Privacy and data
      </h1>
      <p className="max-w-prose text-base text-ink-muted">
        Your data is yours. You can download a copy of it or delete your account at any time. See
        our{" "}
        <Link
          href="/policies/privacy"
          className="text-link underline underline-offset-4 hover:no-underline"
        >
          privacy policy
        </Link>{" "}
        for what we keep and why.
      </p>

      <Card as="section" aria-labelledby="export-title">
        <CardTitle id="export-title" as="h2" className="mb-3">
          Export my data
        </CardTitle>
        <CardBody className="items-start">
          <p className="max-w-prose text-ink-muted">
            A JSON file with your profile, saved addresses, orders and wishlist.
          </p>
          <Button asChild iconStart="upload" variant="secondary">
            <a href="/api/account/export" download="ifonli-my-data.json" data-testid="export-link">
              Download my data
            </a>
          </Button>
        </CardBody>
      </Card>

      <Card as="section" aria-labelledby="delete-title">
        <CardTitle id="delete-title" as="h2" className="mb-3">
          Delete my account
        </CardTitle>
        <CardBody>
          <div className="max-w-prose text-ink-muted">
            <p>
              Deleting your account removes your profile, saved addresses, wishlist and carts, and
              signs you out everywhere.
            </p>
            <p className="mt-2">
              We keep your past orders, with the email and delivery address used on each, because
              tax and consumer law require us to. They are no longer linked to an account, and we
              use them for nothing else.
            </p>
          </div>
          <DeleteAccountForm />
        </CardBody>
      </Card>
    </div>
  );
}
