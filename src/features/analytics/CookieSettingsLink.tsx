"use client";

import { CONSENT_OPEN_EVENT } from "@/lib/analytics/events";

/** Footer control that reopens the consent banner. Only rendered when there is something to choose (see `AnalyticsFooterLink`). */
export function CookieSettingsLink({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      data-testid="cookie-settings"
      onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))}
    >
      Cookie settings
    </button>
  );
}
