import type { Metadata } from "next";

import { TrackForm } from "./TrackForm";

export const metadata: Metadata = {
  title: "Track your order",
  robots: { index: false, follow: true },
};

export default function TrackPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="buy-display buy-display-fx text-4xl leading-tight">Track your order</h1>
        <p className="text-base text-ink-muted">
          Enter your order reference and the email address or mobile number you used at checkout.
          Your reference is in your confirmation email.
        </p>
      </header>
      <TrackForm />
    </div>
  );
}
