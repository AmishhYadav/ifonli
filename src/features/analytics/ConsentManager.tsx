"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/Button";
import { CONSENT_OPEN_EVENT, type ConsentChoice } from "@/lib/analytics/events";

import { consentStore, shouldLoadGa4, shouldShowBanner } from "./consent";
import { disableGa4, loadGa4 } from "./ga4";

export interface ConsentManagerProps {
  ga4Id: string | null;
  consentRequired: boolean;
}

/**
 * The optional GA4 and the banner that gates it (plan 12, DPDP). Renders nothing at all when no GA4 id is
 * configured. The banner is a labelled region, not a modal: it never traps focus or blocks the page, offers
 * both answers with equal weight and neutral wording, and is reopened from the footer's "Cookie settings".
 * The choice lives in the `ifonli_consent` cookie (one word, no personal data).
 */
export function ConsentManager({ ga4Id, consentRequired }: ConsentManagerProps) {
  const snapshot = useSyncExternalStore(consentStore.subscribe, consentStore.getSnapshot, consentStore.getServerSnapshot);
  const ready = snapshot !== "unknown";
  const choice: ConsentChoice | null = snapshot === "granted" || snapshot === "denied" ? snapshot : null;
  const [reopened, setReopened] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!ga4Id) return;
    const onOpen = () => setReopened(true);
    window.addEventListener(CONSENT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, onOpen);
  }, [ga4Id]);

  useEffect(() => {
    if (!ready || !ga4Id) return;
    if (shouldLoadGa4({ ga4Id, consentRequired, choice })) loadGa4(ga4Id);
    else disableGa4(ga4Id);
  }, [ready, ga4Id, consentRequired, choice]);

  useEffect(() => {
    if (reopened) headingRef.current?.focus();
  }, [reopened]);

  const decide = (next: ConsentChoice) => {
    consentStore.set(next);
    setReopened(false);
  };

  if (!ready || !ga4Id || !consentRequired) return null;
  if (!shouldShowBanner({ ga4Id, consentRequired, choice }) && !reopened) return null;

  return (
    <section
      aria-labelledby="consent-heading"
      data-testid="consent-banner"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-card bg-surface p-4 text-ink shadow-card sm:p-5"
    >
      <h2 id="consent-heading" ref={headingRef} tabIndex={-1} className="font-display text-xl outline-none">
        Cookies and analytics
      </h2>
      <p className="mt-2 text-base text-ink-muted">
        We count visits ourselves, without your name or any personal details. Google Analytics is optional and loads
        only if you allow it. You can change this any time from &ldquo;Cookie settings&rdquo; in the footer. See our{" "}
        <Link href="/policies/privacy" className="text-link underline underline-offset-4 hover:no-underline">
          privacy policy
        </Link>
        .
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="secondary" size="sm" onClick={() => decide("granted")} data-testid="consent-allow">
          Allow Google Analytics
        </Button>
        <Button variant="secondary" size="sm" onClick={() => decide("denied")} data-testid="consent-deny">
          No thanks
        </Button>
      </div>
    </section>
  );
}
